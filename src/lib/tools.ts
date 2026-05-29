/**
 * Event normalization and database operations
 */

import { prisma } from './db';
import { ExtractedEvent } from './extractor/schema';
import {
  fingerprintFromNormalizedEvent,
  computeCandidateRowFingerprint,
  findCandidateMatch,
} from './dedupe';
import { parseLocationString } from './extractor/locationExtractor';
import { extractTags, normalizeTags } from './extractor/tagExtractor';
import {
  fromCsvRow,
  normalizeEventForWrite,
  temporalFieldsForPrisma,
} from './eventTemporal';

export interface NormalizeEventsInput {
  events: ExtractedEvent[];
  defaultTimezone?: string;
}

export interface NormalizeEventsResult {
  ok: boolean;
  count: number;
  events: ExtractedEvent[];
  errors?: string[];
}

/**
 * Normalize extracted events - validate dates, clean data
 */
export async function normalize_events(
  input: NormalizeEventsInput
): Promise<NormalizeEventsResult> {
  const { events, defaultTimezone = 'America/New_York' } = input;
  const normalized: ExtractedEvent[] = [];
  const errors: string[] = [];

  // Fetch tags with keywords from database once per batch
  let tagKeywordMap: Record<string, string[]> = {};
  try {
    const tagsWithKeywords = await prisma.tag.findMany({
      where: {
        keywords: { not: null },
      },
    });

    // Build keyword map: { tagName: [keyword1, keyword2, ...] }
    tagsWithKeywords.forEach((tag) => {
      if (tag.keywords) {
        try {
          const keywords = JSON.parse(tag.keywords);
          tagKeywordMap[tag.name] = Array.isArray(keywords) ? keywords : [];
        } catch (e) {
          console.warn(`Invalid keywords JSON for tag ${tag.name}:`, e);
        }
      }
    });
  } catch (error) {
    console.warn('Failed to fetch tags with keywords, using fallback:', error);
    // Continue without tagKeywordMap - extractTags will use hardcoded TAG_KEYWORDS as fallback
  }

  for (const event of events) {
    try {
      // Validate title
      if (!event.title || event.title.trim().length === 0) {
        errors.push(`Event missing title: ${JSON.stringify(event)}`);
        continue;
      }

      if (!event.start) {
        errors.push(`Event "${event.title}" missing valid dates`);
        continue;
      }

      let temporal;
      try {
        const input = fromCsvRow({
          start: event.start,
          end: event.end || event.start,
          timezone: event.timezone || (defaultTimezone ? defaultTimezone : undefined),
        });
        temporal = normalizeEventForWrite({
          ...input,
          timezone:
            input.temporalKind === 'TIMED'
              ? event.timezone || defaultTimezone
              : null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Invalid dates for "${event.title}": ${msg}`);
        continue;
      }

      // Extract and normalize tags (pass tagKeywordMap if available)
      const extractedTags = extractTags(
        event,
        undefined,
        Object.keys(tagKeywordMap).length > 0 ? tagKeywordMap : undefined
      );
      const normalizedTags = normalizeTags(extractedTags.length > 0 ? extractedTags : event.tags || []);

      // Parse location string into structured components
      let city: string | undefined;
      let region: string | undefined;
      let country: string | undefined;

      if (event.location) {
        const parsedLocation = parseLocationString(event.location);
        city = parsedLocation.city;
        region = parsedLocation.region;
        country = parsedLocation.country;
      }

      // Use structured location from event if provided, otherwise use parsed location
      city = event.city || city;
      region = event.region || region;
      country = event.country || country;

      const normalizedEvent: ExtractedEvent = {
        ...event,
        title: event.title.trim(),
        start: temporal.start.toISOString(),
        end: temporal.end.toISOString(),
        timezone: temporal.timezone ?? undefined,
        location: event.location?.trim() || undefined,
        url: event.url?.trim() || undefined,
        description: event.description?.trim() || undefined,
        source: event.source?.trim() || undefined,
        tags: normalizedTags.length > 0 ? normalizedTags : undefined,
        city,
        region,
        country,
      };

      normalized.push(normalizedEvent);
    } catch (error: any) {
      errors.push(`Error normalizing event: ${error.message}`);
    }
  }

  return {
    ok: normalized.length > 0,
    count: normalized.length,
    events: normalized,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export interface UpsertEventsInput {
  events: ExtractedEvent[];
  publish?: boolean;
}

export interface UpsertEventsResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface IngestScrapedEventsResult {
  created: number;
  flaggedDuplicate: number;
  skipped: number;
  errors: number;
}

/**
 * Scrape ingestion: new rows become PENDING. If a DB match exists, create a flagged PENDING row for admin review (no silent merge).
 */
export async function ingestScrapedEvents(
  events: ExtractedEvent[],
  options: { publish?: boolean; hubSlug?: string; hostSlug?: string } = {}
): Promise<IngestScrapedEventsResult> {
  const publish = options.publish ?? false;
  let created = 0;
  let flaggedDuplicate = 0;
  let skipped = 0;
  let errors = 0;

  let hubId: string | null = null;
  let defaultHostId: string | null = null;
  let hubSlugForTag: string | null = null;

  if (options.hubSlug) {
    const hub = await prisma.eventHub.findUnique({
      where: { slug: options.hubSlug },
    });
    if (hub) {
      hubId = hub.id;
      hubSlugForTag = hub.slug;
      if (options.hostSlug) {
        const host = await prisma.hubHost.findUnique({
          where: { hubId_slug: { hubId: hub.id, slug: options.hostSlug } },
        });
        defaultHostId = host?.id ?? null;
      }
    }
  }

  for (const event of events) {
    try {
      if (!event.start || !event.end) {
        skipped++;
        continue;
      }

      let tagsJson =
        event.tags && event.tags.length > 0 ? JSON.stringify(event.tags) : null;

      let hubHostId: string | null = defaultHostId;
      let showOnMainCalendar = false;

      if (hubId && hubSlugForTag) {
        const { appendHubTag, applyHubEventDefaults, resolveHostForIngest } = await import(
          '@/lib/hubs'
        );
        tagsJson = appendHubTag(tagsJson, hubSlugForTag);
        if (!hubHostId && event.source) {
          hubHostId = await resolveHostForIngest(hubId, event.source);
        }
        showOnMainCalendar = applyHubEventDefaults({ hubId }).showOnMainCalendar;
      }

      const temporalInput = fromCsvRow({
        start: event.start,
        end: event.end,
        timezone: event.timezone,
      });
      const temporal = normalizeEventForWrite({
        ...temporalInput,
        timezone:
          temporalInput.temporalKind === 'TIMED'
            ? event.timezone || 'America/New_York'
            : null,
      });

      const baseData = {
        title: event.title,
        description: event.description || null,
        url: event.url || null,
        location: event.location || null,
        ...temporalFieldsForPrisma(temporal),
        source: event.source || null,
        tags: tagsJson,
        country: event.country || null,
        region: event.region || null,
        city: event.city || null,
        hubId,
        hubHostId,
        showOnMainCalendar,
      };

      const match = await findCandidateMatch(event);

      if (!match) {
        const fp = fingerprintFromNormalizedEvent(event);
        await prisma.event.create({
          data: {
            ...baseData,
            dedupeFingerprint: fp,
            status: publish ? 'PUBLISHED' : 'PENDING',
            potentialDuplicateOfId: null,
            duplicateReviewStatus: null,
          },
        });
        created++;
      } else {
        const candidateFp = computeCandidateRowFingerprint({
          title: event.title,
          start: event.start,
          timezone: event.timezone,
          location: event.location,
          url: event.url,
          city: event.city,
          region: event.region,
          country: event.country,
        });
        await prisma.event.create({
          data: {
            ...baseData,
            dedupeFingerprint: candidateFp,
            potentialDuplicateOfId: match.existing.id,
            duplicateReviewStatus: 'PENDING_REVIEW',
            status: 'PENDING',
          },
        });
        flaggedDuplicate++;
      }
    } catch (error: any) {
      console.error(`Error ingesting scraped event "${event.title}":`, error);
      errors++;
    }
  }

  return { created, flaggedDuplicate, skipped, errors };
}

/**
 * Upsert events to database (CSV and other batch imports): update in place when fingerprint or legacy key matches.
 */
export async function upsert_events(
  input: UpsertEventsInput
): Promise<UpsertEventsResult> {
  const { events, publish = false } = input;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of events) {
    try {
      if (!event.start || !event.end) {
        console.log(`Skipping event "${event.title}" - missing start or end date`);
        skipped++;
        continue;
      }

      const fp = fingerprintFromNormalizedEvent(event);

      let existing = await prisma.event.findFirst({
        where: { dedupeFingerprint: fp },
      });

      if (!existing) {
        existing = await prisma.event.findFirst({
          where: {
            title: event.title,
            start: new Date(event.start),
            location: event.location || null,
          },
        });
      }

      // Convert tags array to JSON string for storage
      const tagsJson = event.tags && event.tags.length > 0 
        ? JSON.stringify(event.tags) 
        : null;

      console.log(`Processing event: "${event.title}" - ${existing ? 'UPDATE' : 'CREATE'} - Status: ${publish ? 'PUBLISHED' : 'PENDING'}`);

      if (existing) {
        // Update existing event
        await prisma.event.update({
          where: { id: existing.id },
          data: {
            title: event.title,
            description: event.description || null,
            url: event.url || null,
            location: event.location || null,
            start: new Date(event.start),
            end: new Date(event.end),
            timezone: event.timezone || null,
            source: event.source || null,
            tags: tagsJson,
            country: event.country || null,
            region: event.region || null,
            city: event.city || null,
            dedupeFingerprint: fp,
            status: publish ? 'PUBLISHED' : existing.status,
            updatedAt: new Date(),
          },
        });
        console.log(`✅ Updated event: "${event.title}" (ID: ${existing.id})`);
        updated++;
      } else {
        // Create new event
        const newEvent = await prisma.event.create({
          data: {
            title: event.title,
            description: event.description || null,
            url: event.url || null,
            location: event.location || null,
            start: new Date(event.start),
            end: new Date(event.end),
            timezone: event.timezone || null,
            source: event.source || null,
            tags: tagsJson,
            country: event.country || null,
            region: event.region || null,
            city: event.city || null,
            dedupeFingerprint: fp,
            status: publish ? 'PUBLISHED' : 'PENDING',
          },
        });
        console.log(`✅ Created event: "${event.title}" (ID: ${newEvent.id}, Status: ${newEvent.status})`);
        created++;
      }
    } catch (error: any) {
      console.error(`Error upserting event "${event.title}":`, error);
      console.error('Event data that failed:', JSON.stringify(event, null, 2));
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        meta: error.meta,
      });
      errors++;
    }
  }

  return { created, updated, skipped, errors };
}

