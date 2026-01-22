import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { parse } from 'date-fns';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

interface CSVRow {
  title: string;
  start: string;
  end: string;
  location?: string;
  url?: string;
  description?: string;
  timezone?: string;
  source?: string;
  status?: string;
  all_day?: string; // "true" or "false" to explicitly control all-day status
}

/**
 * Detect whether a date string appears to include a time component
 */
function hasTimeComponent(value?: string | null): boolean {
  if (!value) return false;
  // Check for time patterns: ISO with "T12:00" or human strings with "12:00"
  return /T\d{1,2}:\d{2}/.test(value) || /\d{1,2}:\d{2}/.test(value);
}

/**
 * Parse date string - handles both date-only (YYYY-MM-DD) and ISO formats
 * For date-only strings, parse as UTC to avoid timezone shifts
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const trimmed = dateStr.trim();
  
  // If it's a date-only string (YYYY-MM-DD), parse explicitly as UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  
  // Try parsing as Date (handles ISO and other formats)
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

async function seedFromCSV(csvPath: string) {
  try {
    console.log(`📁 Reading CSV from: ${csvPath}`);
    const csvContent = readFileSync(csvPath, 'utf-8');
    
    // Simple CSV parsing (assumes no commas in values or proper quoting)
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',').map((h) => h.trim());
    
    console.log(`📊 Found ${lines.length - 1} rows to process`);
    
    let successCount = 0;
    let errorCount = 0;

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(',').map((v) => v.trim());
        const row: any = {};
        
        headers.forEach((header, index) => {
          row[header] = values[index] || null;
        });

        // Parse dates using the helper function
        const startDate = parseDate(row.start);
        const endDate = parseDate(row.end || row.start);

        if (!startDate || !endDate) {
          console.error(`⚠️  Row ${i}: Invalid date format`);
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
        const status = row.status === 'PENDING' ? 'PENDING' : 'PUBLISHED';

        // Determine timezone - null for all-day events, provided value or default for timed events
        const timezone = isAllDay
          ? null
          : (row.timezone?.trim() || 'America/New_York');

        // Upsert event (by title and start date as unique key)
        await prisma.event.upsert({
          where: {
            id: row.id || `seed-${i}`,
          },
          create: {
            title: row.title,
            description: row.description || null,
            url: row.url || null,
            location: row.location || null,
            start: finalStartDate,
            end: finalEndDate,
            timezone,
            source: row.source || null,
            status,
          },
          update: {
            title: row.title,
            description: row.description || null,
            url: row.url || null,
            location: row.location || null,
            start: finalStartDate,
            end: finalEndDate,
            timezone,
            source: row.source || null,
            status,
          },
        });
        
        successCount++;
        if (isAllDay) {
          console.log(`✅ Row ${i}: ${row.title} (all-day)`);
        } else {
          console.log(`✅ Row ${i}: ${row.title} (timed, ${timezone})`);
        }
      } catch (error: any) {
        console.error(`❌ Row ${i}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n🎉 Seeding complete!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
  } catch (error: any) {
    console.error('❌ Failed to seed from CSV:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get CSV path from command line args
const csvPath = process.argv[2];

if (!csvPath) {
  console.error('❌ Usage: tsx scripts/seed-from-csv.ts <path-to-csv>');
  process.exit(1);
}

seedFromCSV(csvPath);
