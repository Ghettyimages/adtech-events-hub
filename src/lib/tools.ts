/**
 * Event normalization and database operations
 */

import { prisma } from './db';
import { ExtractedEvent } from './extractor/schema';
import { parse, isValid } from 'date-fns';
import { parseLocationString } from './extractor/locationExtractor';
import { extractTags, normalizeTags } from './extractor/tagExtractor';

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

// Detect whether a date string appears to include a time component
const hasTimeComponent = (value?: string | null): boolean => {
  if (!value) return false;
  // Rough checks: ISO with "T12:00" or human strings with "12:00"
  return /T\d{1,2}:\d{2}/.test(value) || /\d{1,2}:\d{2}/.test(value);
};

/**
 * Normalize extracted events - validate dates, clean data
 */
export async function normalize_events(
  input: NormalizeEventsInput
): Promise<NormalizeEventsResult> {
  const { events, defaultTimezone = 'America/New_York' } = input;
  const normalized: ExtractedEvent[] = [];
  const errors: string[] = [];

  for (const event of events) {
    try {
      // Validate title
      if (!event.title || event.title.trim().length === 0) {
        errors.push(`Event missing title: ${JSON.stringify(event)}`);
        continue;
      }

      // Validate and normalize dates
      let startDate: Date | null = null;
      let endDate: Date | null = null;

      const startHasTime = hasTimeComponent(event.start);
      const endHasTime = hasTimeComponent(event.end);

      // Helper to parse date string, handling both date-only (YYYY-MM-DD) and ISO formats
      const parseDateString = (dateStr: string): Date => {
        // If it's a date-only string (YYYY-MM-DD), parse explicitly as UTC
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const [year, month, day] = dateStr.split('-').map(Number);
          return new Date(Date.UTC(year, month - 1, day));
        }
        // Otherwise, use standard Date parsing (handles ISO strings with times)
        return new Date(dateStr);
      };

      if (event.start) {
        startDate = parseDateString(event.start);
        if (isNaN(startDate.getTime())) {
          errors.push(`Invalid start date for "${event.title}": ${event.start}`);
          continue;
        }
      }

      if (event.end) {
        endDate = parseDateString(event.end);
        if (isNaN(endDate.getTime())) {
          // Use start date if end is invalid
          endDate = startDate;
        }
      } else if (startDate) {
        endDate = startDate;
      }

      // If no dates, skip this event
      if (!startDate || !endDate) {
        errors.push(`Event "${event.title}" missing valid dates`);
        continue;
      }

      // Determine if this is an all-day event (no time component in either start or end)
      const isAllDay = !startHasTime && !endHasTime;

      // For all-day events, use fixed UTC times to prevent timezone shifts
      // Start: 12:00 UTC, End: 22:00 UTC on the same calendar days (inclusive)
      if (isAllDay) {
        // Extract UTC date components to preserve calendar day
        const startYear = startDate.getUTCFullYear();
        const startMonth = startDate.getUTCMonth();
        const startDay = startDate.getUTCDate();
        
        const endYear = endDate.getUTCFullYear();
        const endMonth = endDate.getUTCMonth();
        const endDay = endDate.getUTCDate();

        // Set to fixed UTC times: start at 12:00 UTC, end at 22:00 UTC
        startDate = new Date(Date.UTC(startYear, startMonth, startDay, 12, 0, 0, 0));
        endDate = new Date(Date.UTC(endYear, endMonth, endDay, 22, 0, 0, 0));

        // Ensure end is not before start (for same-day events)
        if (endDate < startDate) {
          endDate = new Date(Date.UTC(startYear, startMonth, startDay, 22, 0, 0, 0));
        }
      } else {
        // For timed events, ensure end is not before start
        if (endDate < startDate) {
          endDate = startDate;
        }

        // Normalize timed events: set to midnight if no time provided
        if (!startHasTime) {
          startDate.setHours(0, 0, 0, 0);
        }
        if (!endHasTime) {
          endDate.setHours(23, 59, 59, 999);
        }
      }

      // Only keep timezone for timed events (when time was captured or provided explicitly)
      // All-day events should have timezone = null/undefined
      const timezone = isAllDay
        ? undefined
        : (event.timezone || ((startHasTime || endHasTime) ? defaultTimezone : undefined));

      // Extract and normalize tags
      const extractedTags = extractTags(event);
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
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        timezone,
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

/**
 * Upsert events to database
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

      // Create a unique key based on title, start date, and location
      const uniqueKey = `${event.title.toLowerCase()}|${event.start}|${event.location || ''}`;

      // Check if event already exists (simple deduplication)
      const existing = await prisma.event.findFirst({
        where: {
          title: event.title,
          start: new Date(event.start),
          location: event.location || null,
        },
      });

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

