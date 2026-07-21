/**
 * Parse pasted festival host schedules into structured session rows via LLM.
 */

import { z } from 'zod';
import { llmText } from './llm';
import { prisma } from './db';
import { extractSponsorFromText, type SponsorKind } from './sponsorExtract';

export const parsedScheduleEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  timezone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sponsoredBy: z.string().nullable().optional(),
  sponsorKind: z.enum(['SPONSORED', 'PARTNERSHIP']).nullable().optional(),
});

export type ParsedScheduleEvent = z.infer<typeof parsedScheduleEventSchema>;

const llmSessionSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start: z.union([z.string(), z.number()]).transform((v) => String(v)),
  end: z.union([z.string(), z.number()]).transform((v) => String(v)),
  timezone: z.string().optional(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v;
      return v
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }),
  sponsoredBy: z.string().nullable().optional(),
  sponsorKind: z
    .union([
      z.enum(['SPONSORED', 'PARTNERSHIP']),
      z.string(),
      z.null(),
    ])
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null || v === '') return null;
      const upper = String(v).trim().toUpperCase();
      if (upper === 'SPONSORED' || upper === 'SPONSOR') return 'SPONSORED' as const;
      if (upper === 'PARTNERSHIP' || upper === 'PARTNER') return 'PARTNERSHIP' as const;
      return null;
    }),
});

const llmResponseSchema = z.object({
  events: z.array(llmSessionSchema),
  warnings: z.array(z.string()).optional(),
});

export interface ParseScheduleOptions {
  rawText: string;
  /** When omitted, parse for the main calendar (no festival hub context). */
  hubSlug?: string;
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
  let body = trimmed;
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?/i, '').replace(/```[\s\S]*$/i, '').trim();
  }
  // If the model added prose around JSON, extract the first object.
  if (!body.startsWith('{')) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      body = body.slice(start, end + 1);
    }
  }
  return body;
}

function coerceSponsorKind(
  value: unknown
): 'SPONSORED' | 'PARTNERSHIP' | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'SPONSORED' || upper === 'SPONSOR') return 'SPONSORED';
  if (
    upper === 'PARTNERSHIP' ||
    upper === 'PARTNER' ||
    upper === 'IN PARTNERSHIP'
  ) {
    return 'PARTNERSHIP';
  }
  return null;
}

function coerceTags(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return undefined;
}

function coerceSessionRow(row: unknown): z.infer<typeof llmSessionSchema> | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : String(r.title ?? '').trim();
  if (!title) return null;
  const start =
    typeof r.start === 'string'
      ? r.start.trim()
      : r.start != null
        ? String(r.start).trim()
        : '';
  const end =
    typeof r.end === 'string'
      ? r.end.trim()
      : r.end != null
        ? String(r.end).trim()
        : '';
  if (!start || !end) return null;

  return {
    title,
    description:
      r.description == null
        ? null
        : typeof r.description === 'string'
          ? r.description
          : String(r.description),
    location:
      r.location == null
        ? null
        : typeof r.location === 'string'
          ? r.location
          : String(r.location),
    start,
    end,
    timezone:
      typeof r.timezone === 'string' && r.timezone.trim()
        ? r.timezone.trim()
        : undefined,
    tags: coerceTags(r.tags),
    sponsoredBy:
      r.sponsoredBy == null || r.sponsoredBy === ''
        ? null
        : String(r.sponsoredBy),
    sponsorKind: coerceSponsorKind(r.sponsorKind),
  };
}

function applySponsorExtraction(
  row: z.infer<typeof llmSessionSchema>,
  hostName: string
): {
  title: string;
  description: string | null | undefined;
  sponsoredBy: string | null;
  sponsorKind: SponsorKind | null;
} {
  let title = row.title.trim();
  let description = row.description;
  let sponsoredBy = row.sponsoredBy?.trim() || null;
  let sponsorKind = (row.sponsorKind as SponsorKind | null | undefined) ?? null;

  if (!sponsoredBy) {
    const fromTitle = extractSponsorFromText(title);
    if (fromTitle.sponsoredBy) {
      sponsoredBy = fromTitle.sponsoredBy;
      sponsorKind = fromTitle.sponsorKind;
      title = fromTitle.cleanedText || title;
    }
  }

  if (!sponsoredBy && description) {
    const fromDesc = extractSponsorFromText(description);
    if (fromDesc.sponsoredBy) {
      sponsoredBy = fromDesc.sponsoredBy;
      sponsorKind = sponsorKind ?? fromDesc.sponsorKind;
    }
  }

  if (
    sponsoredBy &&
    hostName.trim() &&
    sponsoredBy.toLowerCase() === hostName.trim().toLowerCase()
  ) {
    sponsoredBy = null;
    sponsorKind = null;
  }

  return { title, description, sponsoredBy, sponsorKind };
}

function buildSystemPrompt(skipUmbrella: boolean, forHub: boolean): string {
  const umbrellaRule = skipUmbrella
    ? `- Output ONE row per individual session (talk, panel, dinner, reception, etc.).
- Do NOT output multi-day umbrella rows such as "Smartly at Cannes Jun 22–25" or brand presence spanning several days without a specific time slot.`
    : `- Include multi-day umbrella / brand presence rows when they appear in the paste.`;

  const yearRule = forHub
    ? `- Use the hub date range for year when the paste omits a year.`
    : `- When the paste omits a year, prefer an explicit year in the text; otherwise use the current or upcoming year consistent with the dates.`;

  const intro = forHub
    ? 'You extract festival agenda sessions from pasted text into strict JSON.'
    : 'You extract event schedule sessions from pasted text into strict JSON for a main events calendar.';

  return `${intro}

Return ONLY valid JSON with this shape:
{
  "events": [
    {
      "title": "string",
      "description": "string or null",
      "location": "string or null",
      "start": "naive local datetime string YYYY-MM-DDTHH:mm:ss (NO Z, NO numeric offset)",
      "end": "naive local datetime string YYYY-MM-DDTHH:mm:ss (NO Z, NO numeric offset)",
      "timezone": "IANA timezone e.g. America/New_York or Europe/Paris",
      "tags": ["tag-slug", ...],
      "sponsoredBy": "partner/sponsor name only, or null",
      "sponsorKind": "SPONSORED or PARTNERSHIP or null"
    }
  ],
  "warnings": ["optional human-readable notes"]
}

Rules:
${umbrellaRule}
- When a day header appears (e.g. "Monday, June 22, 2026"), apply that date to sessions below until the next day header.
- Parse time ranges like "2:00 PM - 2:45 PM (CEST)" into start and end on that day.
- CRITICAL timezone / wall-clock contract:
  - Emit NAIVE local datetimes only (e.g. "2026-06-22T14:00:00"). Do NOT append "Z" or numeric offsets like "+02:00".
  - Set every row's "timezone" to the provided default IANA timezone unless the paste explicitly names a different zone for that session.
  - Abbreviations like CEST, EDT, EST, PDT are labels only — map them to the provided default IANA timezone when ambiguous; never invent UTC offsets.
- Venue lines (e.g. "Smartly Penthouse", "Amazon Port") belong in location, not title.
- If "[INVITE ONLY]" or similar appears, add tag "invite-only" (you may keep the phrase in the title).
${yearRule}
- For all-day or untimed blocks, use start at 00:00:00 and end at 23:59:59 on that day in the given timezone.
- description: extra detail only (not duplicate of title); null if none.
- tags: lowercase slugs; include invite-only when applicable.
- sponsoredBy: partner or sponsor organization name ONLY (e.g. "Google", "IAB & Yahoo"), or null.
- sponsorKind: "SPONSORED" for "sponsored by" / "presented by" (as funder); "PARTNERSHIP" for "in partnership with" / "in collaboration with"; null if unclear.
- When sponsorship appears in the session title or on its own line, extract to sponsoredBy and REMOVE that phrase from title.
- Do NOT put the source/host organization in sponsoredBy unless the paste explicitly names them as sponsor/partner for that session.
- If a day header or block applies one sponsor to all sessions below until the next header, apply that sponsoredBy to each session in the block.
- Typos: treat "parntership", "sponsered", etc. as partnership/sponsored.
- Multiple sponsors: join with " & " (e.g. "Google & Meta").`;
}

export async function parseHostSchedule(
  options: ParseScheduleOptions
): Promise<ParseScheduleResult> {
  const {
    rawText,
    hubSlug,
    hostName,
    defaultTimezone = 'America/New_York',
    skipUmbrellaEvents = true,
  } = options;

  let userPrompt: string;
  if (hubSlug) {
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

    userPrompt = `Host: ${hostName}
Festival hub: ${hub.name} (${hubSlug})
Hub date range: ${hubStart} to ${hubEnd}
Default timezone: ${defaultTimezone}
Hub timezone (if relevant): ${hubTimezone}
Skip multi-day umbrella events: ${skipUmbrellaEvents ? 'yes' : 'no'}

Pasted schedule:
---
${rawText.slice(0, 120000)}
---`;
  } else {
    userPrompt = `Source / company: ${hostName}
Destination: main calendar (no festival hub)
Default timezone: ${defaultTimezone}
Skip multi-day umbrella events: ${skipUmbrellaEvents ? 'yes' : 'no'}

Pasted schedule:
---
${rawText.slice(0, 120000)}
---`;
  }

  const raw = await llmText({
    system: buildSystemPrompt(skipUmbrellaEvents, Boolean(hubSlug)),
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

  // Prefer strict schema, but fall back to per-row coercion so one bad field
  // (e.g. sponsorKind casing) does not fail the whole paste.
  const validated = llmResponseSchema.safeParse(parsed);
  let rows: z.infer<typeof llmSessionSchema>[] = [];
  const warnings: string[] = [];

  if (validated.success) {
    rows = validated.data.events;
    if (validated.data.warnings?.length) {
      warnings.push(...validated.data.warnings);
    }
  } else {
    const obj = parsed as { events?: unknown; warnings?: unknown };
    if (!obj || !Array.isArray(obj.events)) {
      throw new Error(`Invalid parse shape: ${validated.error.message}`);
    }
    warnings.push(
      'LLM response needed field cleanup (continuing with coerced rows).'
    );
    if (Array.isArray(obj.warnings)) {
      for (const w of obj.warnings) {
        if (typeof w === 'string' && w.trim()) warnings.push(w);
      }
    }
    for (const item of obj.events) {
      const coerced = coerceSessionRow(item);
      if (coerced) rows.push(coerced);
    }
  }

  const events: ParsedScheduleEvent[] = [];

  for (const row of rows) {
    const sponsor = applySponsorExtraction(row, hostName);
    const rowResult = parsedScheduleEventSchema.safeParse({
      ...row,
      title: sponsor.title,
      description: sponsor.description,
      sponsoredBy: sponsor.sponsoredBy,
      sponsorKind: sponsor.sponsorKind,
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
