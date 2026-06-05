import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { parsedScheduleEventSchema } from '@/lib/scheduleParser';
import { ExtractedEvent } from '@/lib/extractor/schema';
import { normalize_events, ingestScrapedEvents } from '@/lib/tools';

const ingestBodySchema = z.object({
  events: z.array(parsedScheduleEventSchema).min(1),
  hubSlug: z.string().min(1),
  hostName: z.string().min(1),
  sourceUrl: z.string().optional(),
  defaultTimezone: z.string().optional().default('Europe/Paris'),
});

function toExtractedEvents(
  events: z.infer<typeof parsedScheduleEventSchema>[],
  hostName: string,
  sourceUrl?: string
): ExtractedEvent[] {
  const source = hostName.trim();
  const url = sourceUrl?.trim() || undefined;
  return events.map((e) => ({
    title: e.title,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    start: e.start,
    end: e.end,
    timezone: e.timezone,
    tags: e.tags,
    source,
    url,
    date_status: 'confirmed' as const,
    location_status: e.location ? ('confirmed' as const) : ('tbd' as const),
  }));
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body = ingestBodySchema.parse(await request.json());
    const extracted = toExtractedEvents(body.events, body.hostName, body.sourceUrl);

    const normalizationResult = await normalize_events({
      events: extracted,
      defaultTimezone: body.defaultTimezone,
    });

    if (!normalizationResult.ok || normalizationResult.count === 0) {
      return NextResponse.json(
        {
          error: 'No events could be normalized',
          normalizationErrors: normalizationResult.errors,
        },
        { status: 400 }
      );
    }

    const ingestResult = await ingestScrapedEvents(normalizationResult.events, {
      publish: false,
      hubSlug: body.hubSlug,
      hostName: body.hostName,
    });

    return NextResponse.json({
      ...ingestResult,
      normalized: normalizationResult.count,
      normalizationErrors: normalizationResult.errors,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : 'Ingest failed';
    console.error('[import-schedule/ingest]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
