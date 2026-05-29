/**
 * One-off backfill: populate temporalKind and civil date columns from legacy rows.
 * Run after schema migration, before repair.
 *
 * Usage:
 *   npx tsx scripts/backfill-event-temporal.ts --dry-run
 *   npx tsx scripts/backfill-event-temporal.ts --apply
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  civilDateFromUtcInstant,
  formatYmdUtc,
  inferTemporalKindFromLegacy,
  TEMPORAL_KIND,
} from '../src/lib/eventTemporal';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes('--apply') };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const events = await prisma.event.findMany();
  let updated = 0;

  for (const event of events) {
    const kind =
      event.temporalKind === TEMPORAL_KIND.TIMED ||
      event.temporalKind === TEMPORAL_KIND.ALL_DAY
        ? event.temporalKind
        : inferTemporalKindFromLegacy(event.timezone);

    const start = new Date(event.start);
    const end = new Date(event.end);

    const data =
      kind === TEMPORAL_KIND.ALL_DAY
        ? {
            temporalKind: TEMPORAL_KIND.ALL_DAY,
            allDayStartDate: civilDateFromUtcInstant(start),
            allDayEndDate: civilDateFromUtcInstant(end),
          }
        : {
            temporalKind: TEMPORAL_KIND.TIMED,
            allDayStartDate: null,
            allDayEndDate: null,
          };

    const needsUpdate =
      event.temporalKind !== data.temporalKind ||
      (data.allDayStartDate &&
        (!event.allDayStartDate ||
          formatYmdUtc(new Date(event.allDayStartDate)) !==
            formatYmdUtc(data.allDayStartDate))) ||
      (data.allDayEndDate &&
        (!event.allDayEndDate ||
          formatYmdUtc(new Date(event.allDayEndDate)) !==
            formatYmdUtc(data.allDayEndDate))) ||
      (kind === TEMPORAL_KIND.TIMED &&
        (event.allDayStartDate != null || event.allDayEndDate != null));

    if (!needsUpdate) continue;

    if (apply) {
      await prisma.event.update({
        where: { id: event.id },
        data,
      });
    }

    updated++;
    console.log(
      `${apply ? 'UPDATED' : 'WOULD UPDATE'} ${event.id} ${event.title} -> ${kind}` +
        (data.allDayStartDate
          ? ` ${formatYmdUtc(data.allDayStartDate)}..${formatYmdUtc(data.allDayEndDate!)}`
          : '')
    );
  }

  console.log(
    `\n${apply ? 'Updated' : 'Would update'} ${updated} of ${events.length} events.`
  );
  if (!apply) {
    console.log('Re-run with --apply to write changes.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
