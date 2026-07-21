import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { parsedScheduleEventSchema } from '@/lib/scheduleParser';
import { ExtractedEvent } from '@/lib/extractor/schema';
import { prisma } from '@/lib/db';
import { normalize_events, ingestScrapedEvents } from '@/lib/tools';
import { DEFAULT_TIMED_ZONE } from '@/lib/eventTemporal';
import { sanitizeScheduleWallClock } from '@/lib/scheduleWallClock';

const ingestBodySchema = z.object({
  events: z.array(parsedScheduleEventSchema).min(1),
  hubSlug: z.string().min(1).optional(),
  hostName: z.string().min(1),
  sourceUrl: z.string().optional(),
  defaultTimezone: z.string().optional().default(DEFAULT_TIMED_ZONE),
});

function toExtractedEvents(
  events: z.infer<typeof parsedScheduleEventSchema>[],
  hostName: string,
  defaultTimezone: string,
  sourceUrl?: string
): ExtractedEvent[] {
  const source = hostName.trim();
  const url = sourceUrl?.trim() || undefined;
  return events.map((e) => {
    const timezone = (e.timezone?.trim() || defaultTimezone).trim();
    return {
      title: e.title,
      description: e.description ?? undefined,
      location: e.location ?? undefined,
      start: sanitizeScheduleWallClock(e.start, timezone),
      end: sanitizeScheduleWallClock(e.end, timezone),
      timezone,
      tags: e.tags,
      sponsoredBy: e.sponsoredBy ?? undefined,
      sponsorKind: e.sponsorKind ?? undefined,
      source,
      url,
      date_status: 'confirmed' as const,
      location_status: e.location ? ('confirmed' as const) : ('tbd' as const),
    };
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body = ingestBodySchema.parse(await request.json());
    const extracted = toExtractedEvents(
      body.events,
      body.hostName,
      body.defaultTimezone,
      body.sourceUrl
    );

    let timezone = body.defaultTimezone;
    if (body.hubSlug) {
      const hub = await prisma.eventHub.findUnique({
        where: { slug: body.hubSlug },
        select: { timezone: true },
      });
      timezone = hub?.timezone ?? body.defaultTimezone;
    }

    // First-pass normalize must use the correct zone. ingestScrapedEvents will
    // normalize again; after this pass start/end are UTC ISO with Z, so the
    // second pass preserves instants (parseTimedToUtc offset/Z branch).
    const normalizationResult = await normalize_events({
      events: extracted,
      defaultTimezone: timezone,
      hubTimezone: body.hubSlug ? timezone : undefined,
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
      destination: body.hubSlug ? 'hub' : 'main',
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
