import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import Papa from 'papaparse';
import { parse, isValid } from 'date-fns';

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

        // Parse dates using the same logic as normalize_events
        const startDate = parseDate(row.start);
        const endDate = parseDate(row.end || row.start);

        if (!startDate) {
          errors.push(`Row ${i + 2}: Invalid start date: ${row.start}`);
          errorCount++;
          continue;
        }

        if (!endDate) {
          errors.push(`Row ${i + 2}: Invalid end date: ${row.end || row.start}`);
          errorCount++;
          continue;
        }

        // Check if dates have time components
        const startHasTime = hasTimeComponent(row.start);
        const endHasTime = hasTimeComponent(row.end || row.start);
        
        // Determine all-day status: explicit all_day column overrides auto-detection
        let isAllDay: boolean;
        if (row.all_day !== undefined && row.all_day !== null && row.all_day !== '') {
          // Explicit all_day column provided - parse it
          const allDayValue = row.all_day.trim().toLowerCase();
          isAllDay = allDayValue === 'true' || allDayValue === '1' || allDayValue === 'yes';
        } else {
          // Auto-detect: no time component means all-day
          isAllDay = !startHasTime && !endHasTime;
        }

        // For all-day events, use fixed UTC times to prevent timezone shifts
        // Start: 12:00 UTC, End: 22:00 UTC on the same calendar days (inclusive)
        let finalStartDate = startDate;
        let finalEndDate = endDate;

        if (isAllDay) {
          // Extract UTC date components to preserve calendar day
          const startYear = startDate.getUTCFullYear();
          const startMonth = startDate.getUTCMonth();
          const startDay = startDate.getUTCDate();
          
          const endYear = endDate.getUTCFullYear();
          const endMonth = endDate.getUTCMonth();
          const endDay = endDate.getUTCDate();

          // Set to fixed UTC times: start at 12:00 UTC, end at 22:00 UTC
          finalStartDate = new Date(Date.UTC(startYear, startMonth, startDay, 12, 0, 0, 0));
          finalEndDate = new Date(Date.UTC(endYear, endMonth, endDay, 22, 0, 0, 0));

          // Ensure end is not before start (for same-day events)
          if (finalEndDate < finalStartDate) {
            finalEndDate = new Date(Date.UTC(startYear, startMonth, startDay, 22, 0, 0, 0));
          }
        } else {
          // For timed events, ensure end is not before start
          if (finalEndDate < finalStartDate) {
            finalEndDate = finalStartDate;
          }
        }

        // Determine status
        const status = publishImmediately 
          ? 'PUBLISHED' 
          : (row.status?.toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING');

        // Determine timezone - only for timed events
        const timezone = isAllDay
          ? null
          : (row.timezone?.trim() || 'America/New_York');

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

        // Check if event already exists (by title + start date)
        const existing = await prisma.event.findFirst({
          where: {
            title: row.title.trim(),
            start: startDate,
          },
        });

        if (existing) {
          // Update existing event
          await prisma.event.update({
            where: { id: existing.id },
            data: {
              title: row.title.trim(),
              description: row.description?.trim() || null,
              url: row.url?.trim() || null,
              location: row.location?.trim() || null,
              start: finalStartDate,
              end: finalEndDate,
              timezone,
              source: row.source?.trim() || null,
              tags: tagsJson,
              country: row.country?.trim() || null,
              region: row.region?.trim() || null,
              city: row.city?.trim() || null,
              status,
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
              start: finalStartDate,
              end: finalEndDate,
              timezone,
              source: row.source?.trim() || null,
              tags: tagsJson,
              country: row.country?.trim() || null,
              region: row.region?.trim() || null,
              city: row.city?.trim() || null,
              status,
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

