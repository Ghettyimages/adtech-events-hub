/**
 * Migration script to set all events as all-day events
 * 
 * This script sets the timezone field to null for ALL events in the database,
 * ensuring they are treated as all-day events when synced to Google Calendar.
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
  console.log('🔍 Scanning for events with timezone set...\n');
  
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

    if (eventsWithTimezone.length === 0) {
      console.log('✅ All events are already set as all-day events (timezone is null)!');
      return;
    }

    // Display events that will be fixed
    console.log('📝 Events to be updated (timezone will be set to null for all-day sync):\n');
    console.log('─'.repeat(80));
    
    for (const event of eventsWithTimezone) {
      console.log(`  📅 ${event.title}`);
      console.log(`     ID: ${event.id}`);
      console.log(`     Start: ${event.start.toISOString()}`);
      console.log(`     End: ${event.end.toISOString()}`);
      console.log(`     Current timezone: ${event.timezone}`);
      console.log(`     Action: Set timezone to NULL (all-day event)`);
      console.log('─'.repeat(80));
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total events to update: ${eventsWithTimezone.length}`);

    // Apply fixes if not dry run
    if (!dryRun) {
      console.log('\n🔧 Applying updates...\n');
      
      // Use a single updateMany for efficiency
      const result = await prisma.event.updateMany({
        where: {
          timezone: {
            not: null,
          },
        },
        data: { timezone: null },
      });
      
      console.log(`\n🎉 Successfully updated ${result.count} events to all-day!`);
      console.log('   All events will now sync as all-day events to Google Calendar.');
    } else {
      console.log('\n💡 To apply these changes, run without --dry-run flag:');
      console.log('   npx tsx scripts/fix-allday-events.ts');
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
