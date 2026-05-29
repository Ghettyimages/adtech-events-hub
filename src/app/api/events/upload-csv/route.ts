import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  appendHubTag,
  applyHubEventDefaults,
  resolveHostForIngest,
} from '@/lib/hubs';
import Papa from 'papaparse';
import { parse, isValid } from 'date-fns';
import {
  fromCsvRow,
  normalizeEventForWrite,
  temporalFieldsForPrisma,
} from '@/lib/eventTemporal';

interface CSVRow {
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  url?: string;
  description?: string;
  timezone?: string;
  source?: string;
  status?: string;
  tags?: string; // Comma-separated tags
  country?: string;
  region?: string;
  city?: string;
  all_day?: string; // "true" or "false" to explicitly control all-day status
  temporal_kind?: string;
  hub_slug?: string;
  host_slug?: string;
}

/**
 * Detect whether a date string appears to include a time component
 */
function hasTimeComponent(value?: string | null): boolean {
  if (!value) return false;
  // Rough checks: ISO with "T12:00" or human strings with "12:00"
  return /T\d{1,2}:\d{2}/.test(value) || /\d{1,2}:\d{2}/.test(value);
}

/**
 * Parse date string - handles multiple formats and prevents timezone shifts
 * Uses the same logic as normalize_events in tools.ts
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  
  const trimmed = dateStr.trim();
  
  // Helper to parse date string, handling both date-only (YYYY-MM-DD) and ISO formats
  // If it's a date-only string (YYYY-MM-DD), parse explicitly as UTC to avoid timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  
  // Try ISO format (may include time)
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }
  
  // Try common formats with date-fns
  const formats = [
    'yyyy-MM-dd',
    'MM/dd/yyyy',
    'MMM d, yyyy',
    'MMMM d, yyyy',
  ];
  
  for (const format of formats) {
    try {
      const parsed = parse(trimmed, format, new Date());
      if (isValid(parsed)) {
        // For date-only formats, convert to UTC to avoid timezone shifts
        if (format === 'yyyy-MM-dd' || format === 'MM/dd/yyyy') {
          const year = parsed.getFullYear();
          const month = parsed.getMonth();
          const day = parsed.getDate();
          return new Date(Date.UTC(year, month, day));
        }
        return parsed;
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const publishImmediately = formData.get('publish') === 'true';

    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must be a CSV' },
        { status: 400 }
      );
    }

    // Read file content
    const text = await file.text();

    // Parse CSV with papaparse
    const parseResult = Papa.parse<CSVRow>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
      transform: (value) => value.trim(),
    });

    if (parseResult.errors.length > 0) {
      console.warn('CSV parsing warnings:', parseResult.errors);
    }

    const rows = parseResult.data;
    
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'CSV file is empty or has no valid rows' },
        { status: 400 }
      );
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      try {
        // Validate required fields
        if (!row.title || !row.title.trim()) {
          errors.push(`Row ${i + 2}: Missing title`);
          errorCount++;
          continue;
        }

        if (!row.start?.trim()) {
          errors.push(`Row ${i + 2}: Missing start date`);
          errorCount++;
          continue;
        }

        let temporal;
        try {
          const input = fromCsvRow({
            start: row.start,
            end: row.end || row.start,
            timezone: row.timezone,
            all_day: row.all_day,
            temporal_kind: row.temporal_kind,
          });
          temporal = normalizeEventForWrite({
            ...input,
            timezone:
              input.temporalKind === 'TIMED'
                ? row.timezone?.trim() || 'America/New_York'
                : null,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${i + 2}: ${msg}`);
          errorCount++;
          continue;
        }

        const temporalData = temporalFieldsForPrisma(temporal);

        const status = publishImmediately
          ? 'PUBLISHED'
          : row.status?.toUpperCase() === 'PUBLISHED'
            ? 'PUBLISHED'
            : 'PENDING';

        // Parse tags if provided
        let tagsJson: string | null = null;
        if (row.tags) {
          const tags = row.tags
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);
          if (tags.length > 0) {
            tagsJson = JSON.stringify(tags);
          }
        }

        let hubId: string | null = null;
        let hubHostId: string | null = null;
        let showOnMainCalendar = false;

        if (row.hub_slug?.trim()) {
          const hub = await prisma.eventHub.findUnique({
            where: { slug: row.hub_slug.trim() },
          });
          if (hub) {
            hubId = hub.id;
            if (row.host_slug?.trim()) {
              const host = await prisma.hubHost.findUnique({
                where: {
                  hubId_slug: { hubId: hub.id, slug: row.host_slug.trim() },
                },
              });
              hubHostId = host?.id ?? null;
            } else if (row.source?.trim()) {
              hubHostId = await resolveHostForIngest(hub.id, row.source.trim());
            }
            if (tagsJson && hub.slug) {
              tagsJson = appendHubTag(tagsJson, hub.slug);
            } else if (hub.slug) {
              tagsJson = appendHubTag(null, hub.slug);
            }
            showOnMainCalendar = applyHubEventDefaults({ hubId }).showOnMainCalendar;
          }
        }

        // Check if event already exists (by title + start date)
        const existing = await prisma.event.findFirst({
          where: {
            title: row.title.trim(),
            start: temporalData.start,
          },
        });

        if (existing) {
          await prisma.event.update({
            where: { id: existing.id },
            data: {
              title: row.title.trim(),
              description: row.description?.trim() || null,
              url: row.url?.trim() || null,
              location: row.location?.trim() || null,
              ...temporalData,
              source: row.source?.trim() || null,
              tags: tagsJson,
              country: row.country?.trim() || null,
              region: row.region?.trim() || null,
              city: row.city?.trim() || null,
              status,
              hubId,
              hubHostId,
              showOnMainCalendar,
              updatedAt: new Date(),
            },
          });
        } else {
          // Create new event
          await prisma.event.create({
            data: {
              title: row.title.trim(),
              description: row.description?.trim() || null,
              url: row.url?.trim() || null,
              location: row.location?.trim() || null,
              ...temporalData,
              source: row.source?.trim() || null,
              tags: tagsJson,
              country: row.country?.trim() || null,
              region: row.region?.trim() || null,
              city: row.city?.trim() || null,
              status,
              hubId,
              hubHostId,
              showOnMainCalendar,
            },
          });
        }

        successCount++;
      } catch (error: any) {
        errors.push(`Row ${i + 2}: ${error.message}`);
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${rows.length} rows`,
      stats: {
        total: rows.length,
        success: successCount,
        errors: errorCount,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('CSV upload error:', error);
    return NextResponse.json(
      { error: `Failed to process CSV: ${error.message}` },
      { status: 500 }
    );
  }
}

