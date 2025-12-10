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

        // Parse dates
        const startDate = new Date(row.start);
        const endDate = new Date(row.end);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          console.error(`⚠️  Row ${i}: Invalid date format`);
          errorCount++;
          continue;
        }

        // Determine status
        const status = row.status === 'PENDING' ? 'PENDING' : 'PUBLISHED';

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
            start: startDate,
            end: endDate,
            timezone: row.timezone || 'America/New_York',
            source: row.source || null,
            status,
          },
          update: {
            title: row.title,
            description: row.description || null,
            url: row.url || null,
            location: row.location || null,
            start: startDate,
            end: endDate,
            timezone: row.timezone || 'America/New_York',
            source: row.source || null,
            status,
          },
        });

        successCount++;
        console.log(`✅ Row ${i}: ${row.title}`);
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
