/**
 * Migration script to fix all-day events in the database
 * 
 * This script identifies events that should be all-day events and sets their
 * timezone to null so they're correctly detected as all-day.
 * 
 * All-day events are identified by:
 * 1. Start time is exactly 12:00:00 UTC (the fixed time used for all-day storage)
 * 2. End time is exactly 22:00:00 UTC (the fixed time used for all-day storage)
 * 
 * Usage: npx tsx scripts/fix-allday-events.ts [--dry-run]
 *   --dry-run: Preview changes without applying them
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function fixAllDayEvents(dryRun: boolean = false) {
  console.log('🔍 Scanning for events that should be all-day...\n');
  
  if (dryRun) {
    console.log('📋 DRY RUN MODE - No changes will be made\n');
  }

  try {
    // Fetch all events that have a timezone set (not null)
    const eventsWithTimezone = await prisma.event.findMany({
      where: {
        timezone: {
          not: null,
        },
      },
      orderBy: { start: 'asc' },
    });

    console.log(`📊 Found ${eventsWithTimezone.length} events with timezone set\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    const eventsToFix: Array<{ id: string; title: string; start: Date; end: Date; timezone: string | null }> = [];

    for (const event of eventsWithTimezone) {
      const startHour = event.start.getUTCHours();
      const startMinute = event.start.getUTCMinutes();
      const startSecond = event.start.getUTCSeconds();
      
      const endHour = event.end.getUTCHours();
      const endMinute = event.end.getUTCMinutes();
      const endSecond = event.end.getUTCSeconds();

      // Check if this looks like an all-day event:
      // Start at 12:00:00 UTC and end at 22:00:00 UTC (our fixed times for all-day)
      // OR start at 00:00:00 UTC (midnight - common for all-day events)
      const isAllDayPattern = 
        // Pattern 1: Our fixed UTC times (12:00 start, 22:00 end)
        (startHour === 12 && startMinute === 0 && startSecond === 0 &&
         endHour === 22 && endMinute === 0 && endSecond === 0) ||
        // Pattern 2: Midnight to midnight (00:00 to 00:00)
        (startHour === 0 && startMinute === 0 && startSecond === 0 &&
         endHour === 0 && endMinute === 0 && endSecond === 0) ||
        // Pattern 3: Start at midnight, end at 23:59:59
        (startHour === 0 && startMinute === 0 && startSecond === 0 &&
         endHour === 23 && endMinute === 59);

      if (isAllDayPattern) {
        eventsToFix.push({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          timezone: event.timezone,
        });
        fixedCount++;
      } else {
        skippedCount++;
      }
    }

    // Display events that will be fixed
    if (eventsToFix.length > 0) {
      console.log('📝 Events to be fixed (timezone will be set to null):\n');
      console.log('─'.repeat(80));
      
      for (const event of eventsToFix) {
        console.log(`  📅 ${event.title}`);
        console.log(`     ID: ${event.id}`);
        console.log(`     Start: ${event.start.toISOString()}`);
        console.log(`     End: ${event.end.toISOString()}`);
        console.log(`     Current timezone: ${event.timezone}`);
        console.log(`     Action: Set timezone to NULL (all-day event)`);
        console.log('─'.repeat(80));
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Events to fix: ${fixedCount}`);
    console.log(`   Events skipped (have specific times): ${skippedCount}`);

    // Apply fixes if not dry run
    if (!dryRun && eventsToFix.length > 0) {
      console.log('\n🔧 Applying fixes...\n');
      
      for (const event of eventsToFix) {
        await prisma.event.update({
          where: { id: event.id },
          data: { timezone: null },
        });
        console.log(`  ✅ Fixed: ${event.title}`);
      }
      
      console.log(`\n🎉 Successfully fixed ${fixedCount} events!`);
    } else if (dryRun && eventsToFix.length > 0) {
      console.log('\n💡 To apply these changes, run without --dry-run flag');
    } else if (eventsToFix.length === 0) {
      console.log('\n✅ No events need to be fixed!');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

fixAllDayEvents(dryRun);

