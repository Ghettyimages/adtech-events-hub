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
}

/**
 * Parse date string - handles multiple formats
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  
  // Try ISO format first
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }
  
  // Try common formats
  const formats = [
    'yyyy-MM-dd',
    'MM/dd/yyyy',
    'MMM d, yyyy',
    'MMMM d, yyyy',
  ];
  
  for (const format of formats) {
    try {
      const parsed = parse(dateStr, format, new Date());
      if (isValid(parsed)) {
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

        // Parse dates
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

        // Determine status
        const status = publishImmediately 
          ? 'PUBLISHED' 
          : (row.status?.toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING');

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
              start: startDate,
              end: endDate,
              timezone: row.timezone?.trim() || 'America/New_York',
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
              start: startDate,
              end: endDate,
              timezone: row.timezone?.trim() || 'America/New_York',
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

