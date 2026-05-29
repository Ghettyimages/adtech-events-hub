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

        const { fromCsvRow, normalizeEventForWrite, temporalFieldsForPrisma } = await import(
          '../src/lib/eventTemporal'
        );

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
        } catch {
          console.error(`⚠️  Row ${i}: Invalid date format`);
          errorCount++;
          continue;
        }

        const temporalData = temporalFieldsForPrisma(temporal);
        const status = row.status === 'PENDING' ? 'PENDING' : 'PUBLISHED';

        await prisma.event.upsert({
          where: {
            id: row.id || `seed-${i}`,
          },
          create: {
            title: row.title,
            description: row.description || null,
            url: row.url || null,
            location: row.location || null,
            ...temporalData,
            source: row.source || null,
            status,
          },
          update: {
            title: row.title,
            description: row.description || null,
            url: row.url || null,
            location: row.location || null,
            ...temporalData,
            source: row.source || null,
            status,
          },
        });

        successCount++;
        console.log(
          `✅ Row ${i}: ${row.title} (${temporal.temporalKind}${temporal.timezone ? `, ${temporal.timezone}` : ''})`
        );
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
