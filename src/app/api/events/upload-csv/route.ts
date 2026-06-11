import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { appendHubTag, applyHubEventDefaults } from '@/lib/hubs';
import {
  CsvIngestCache,
  parseCsvSponsorFields,
  type CsvHubColumns,
} from '@/lib/csvHubIngest';
import Papa from 'papaparse';
import { parse, isValid } from 'date-fns';
import {
  TEMPORAL_KIND,
  fromCsvRow,
  normalizeEventForHubIngest,
  normalizeEventForWrite,
  temporalFieldsForPrisma,
} from '@/lib/eventTemporal';

interface CSVRow extends CsvHubColumns {
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  url?: string;
  description?: string;
  timezone?: string;
  status?: string;
  tags?: string;
  country?: string;
  region?: string;
  city?: string;
  all_day?: string;
  temporal_kind?: string;
}

function hasTimeComponent(value?: string | null): boolean {
  if (!value) return false;
  return /T\d{1,2}:\d{2}/.test(value) || /\d{1,2}:\d{2}/.test(value);
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const formats = ['yyyy-MM-dd', 'MM/dd/yyyy', 'MMM d, yyyy', 'MMMM d, yyyy'];

  for (const format of formats) {
    try {
      const parsed = parse(trimmed, format, new Date());
      if (isValid(parsed)) {
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
    const defaultHubSlug = (formData.get('hubSlug') as string | null)?.trim() || null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 });
    }

    const text = await file.text();

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

    const ingestCache = new CsvIngestCache();
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const sponsorFields = parseCsvSponsorFields(row);
        const eventTitle = sponsorFields.title?.trim() || row.title?.trim();

        if (!eventTitle) {
          errors.push(`Row ${i + 2}: Missing title`);
          errorCount++;
          continue;
        }

        if (!row.start?.trim()) {
          errors.push(`Row ${i + 2}: Missing start date`);
          errorCount++;
          continue;
        }

        const rowHubSlug = row.hub_slug?.trim() || defaultHubSlug;
        let rowHubTimezone: string | null = null;
        let resolvedHub: { id: string; timezone: string | null } | null = null;

        if (!rowHubSlug && (row.host_slug || row.host_name)) {
          errors.push(`Row ${i + 2}: host_slug/host_name requires hub_slug`);
          errorCount++;
          continue;
        }

        if (rowHubSlug) {
          try {
            const eventStart = parseDate(row.start);
            const eventEnd = parseDate(row.end || row.start);
            resolvedHub = await ingestCache.resolveHub(
              rowHubSlug,
              row,
              parseDate,
              eventStart ?? undefined,
              eventEnd ?? undefined
            );
            rowHubTimezone = resolvedHub.timezone;
          } catch (hubErr: unknown) {
            const msg = hubErr instanceof Error ? hubErr.message : String(hubErr);
            errors.push(`Row ${i + 2}: ${msg}`);
            errorCount++;
            continue;
          }
        }

        let temporal;
        try {
          const input = fromCsvRow({
            start: row.start,
            end: row.end || row.start,
            timezone: row.timezone || rowHubTimezone || undefined,
            all_day: row.all_day,
            temporal_kind: row.temporal_kind,
          });
          if (rowHubTimezone && hasTimeComponent(row.start)) {
            input.temporalKind = TEMPORAL_KIND.TIMED;
          }
          const defaultTz = rowHubTimezone || row.timezone?.trim() || 'America/New_York';
          if (rowHubTimezone) {
            temporal = normalizeEventForHubIngest(
              {
                ...input,
                timezone: input.temporalKind === TEMPORAL_KIND.TIMED ? defaultTz : null,
              },
              rowHubTimezone
            ).normalized;
          } else {
            temporal = normalizeEventForWrite({
              ...input,
              timezone:
                input.temporalKind === TEMPORAL_KIND.TIMED ? defaultTz : null,
            });
          }
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

        let tagsJson: string | null = null;
        if (row.tags) {
          const tags = row.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          if (tags.length > 0) {
            tagsJson = JSON.stringify(tags);
          }
        }

        let hubId: string | null = null;
        let hubHostId: string | null = null;
        let showOnMainCalendar = false;

        if (rowHubSlug && resolvedHub) {
          hubId = resolvedHub.id;

          if (row.host_slug?.trim() || row.host_name?.trim() || row.source?.trim()) {
            hubHostId = await ingestCache.resolveHost(resolvedHub.id, row);
          }

          if (tagsJson) {
            tagsJson = appendHubTag(tagsJson, rowHubSlug);
          } else {
            tagsJson = appendHubTag(null, rowHubSlug);
          }
          showOnMainCalendar = applyHubEventDefaults({ hubId }).showOnMainCalendar;
        }

        const eventSource = row.source?.trim() || null;

        const existing = await prisma.event.findFirst({
          where: {
            title: eventTitle,
            start: temporalData.start,
          },
        });

        const eventData = {
          title: eventTitle,
          description: row.description?.trim() || null,
          url: row.url?.trim() || null,
          location: row.location?.trim() || null,
          ...temporalData,
          source: eventSource,
          sponsoredBy: sponsorFields.sponsoredBy,
          sponsorKind: sponsorFields.sponsorKind,
          tags: tagsJson,
          country: row.country?.trim() || null,
          region: row.region?.trim() || null,
          city: row.city?.trim() || null,
          status,
          hubId,
          hubHostId,
          showOnMainCalendar,
        };

        if (existing) {
          await prisma.event.update({
            where: { id: existing.id },
            data: {
              ...eventData,
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.event.create({ data: eventData });
        }

        successCount++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Row ${i + 2}: ${message}`);
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
        hubsCreated: ingestCache.hubsCreated,
        hostsCreated: ingestCache.hostsCreated,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('CSV upload error:', error);
    return NextResponse.json({ error: `Failed to process CSV: ${message}` }, { status: 500 });
  }
}
