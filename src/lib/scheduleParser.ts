/**
 * Parse pasted festival host schedules into structured session rows via LLM.
 */

import { z } from 'zod';
import { llmText } from './llm';
import { prisma } from './db';

export const parsedScheduleEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  timezone: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type ParsedScheduleEvent = z.infer<typeof parsedScheduleEventSchema>;

const llmSessionSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: z.string(),
  end: z.string(),
  timezone: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const llmResponseSchema = z.object({
  events: z.array(llmSessionSchema),
  warnings: z.array(z.string()).optional(),
});

export interface ParseScheduleOptions {
  rawText: string;
  hubSlug: string;
  hostName: string;
  defaultTimezone?: string;
  sourceUrl?: string;
  skipUmbrellaEvents?: boolean;
}

export interface ParseScheduleResult {
  events: ParsedScheduleEvent[];
  warnings?: string[];
}

function sanitizeJsonResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  return trimmed;
}

function buildSystemPrompt(skipUmbrella: boolean): string {
  const umbrellaRule = skipUmbrella
    ? `- Output ONE row per individual session (talk, panel, dinner, reception, etc.).
- Do NOT output multi-day umbrella rows such as "Smartly at Cannes Jun 22–25" or brand presence spanning several days without a specific time slot.`
    : `- Include multi-day umbrella / brand presence rows when they appear in the paste.`;

  return `You extract festival agenda sessions from pasted text into strict JSON.

Return ONLY valid JSON with this shape:
{
  "events": [
    {
      "title": "string",
      "description": "string or null",
      "location": "string or null",
      "start": "ISO 8601 datetime or parseable datetime string",
      "end": "ISO 8601 datetime or parseable datetime string",
      "timezone": "IANA timezone e.g. Europe/Paris",
      "tags": ["tag-slug", ...]
    }
  ],
  "warnings": ["optional human-readable notes"]
}

Rules:
${umbrellaRule}
- When a day header appears (e.g. "Monday, June 22, 2026"), apply that date to sessions below until the next day header.
- Parse time ranges like "2:00 PM - 2:45 PM (CEST)" into start and end on that day; use the stated timezone or the default timezone provided.
- Venue lines (e.g. "Smartly Penthouse", "Amazon Port") belong in location, not title.
- If "[INVITE ONLY]" or similar appears, add tag "invite-only" (you may keep the phrase in the title).
- Use the hub date range for year when the paste omits a year.
- For all-day or untimed blocks, use start at 00:00:00 and end at 23:59:59 on that day in the given timezone.
- description: extra detail only (not duplicate of title); null if none.
- tags: lowercase slugs; include invite-only when applicable.`;
}

export async function parseHostSchedule(
  options: ParseScheduleOptions
): Promise<ParseScheduleResult> {
  const {
    rawText,
    hubSlug,
    hostName,
    defaultTimezone = 'Europe/Paris',
    skipUmbrellaEvents = true,
  } = options;

  const hub = await prisma.eventHub.findUnique({
    where: { slug: hubSlug },
    select: { name: true, start: true, end: true, timezone: true },
  });

  if (!hub) {
    throw new Error(`Hub not found: ${hubSlug}`);
  }

  const hubStart = hub.start.toISOString().slice(0, 10);
  const hubEnd = hub.end.toISOString().slice(0, 10);
  const hubTimezone = hub.timezone || defaultTimezone;

  const userPrompt = `Host: ${hostName}
Festival hub: ${hub.name} (${hubSlug})
Hub date range: ${hubStart} to ${hubEnd}
Default timezone: ${defaultTimezone}
Hub timezone (if relevant): ${hubTimezone}
Skip multi-day umbrella events: ${skipUmbrellaEvents ? 'yes' : 'no'}

Pasted schedule:
---
${rawText.slice(0, 120000)}
---`;

  const raw = await llmText({
    system: buildSystemPrompt(skipUmbrellaEvents),
    user: userPrompt,
    temperature: 0.2,
    maxTokens: 8000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonResponse(raw));
  } catch {
    throw new Error('LLM returned invalid JSON');
  }

  const validated = llmResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Invalid parse shape: ${validated.error.message}`);
  }

  const events: ParsedScheduleEvent[] = [];
  const warnings = [...(validated.data.warnings ?? [])];

  for (const row of validated.data.events) {
    const rowResult = parsedScheduleEventSchema.safeParse({
      ...row,
      timezone: row.timezone || defaultTimezone,
    });
    if (rowResult.success) {
      events.push(rowResult.data);
    } else {
      warnings.push(`Skipped invalid row "${row.title}": ${rowResult.error.message}`);
    }
  }

  if (events.length === 0) {
    warnings.push('No valid sessions were extracted from the paste.');
  }

  return {
    events,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
