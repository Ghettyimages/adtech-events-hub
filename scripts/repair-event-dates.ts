/**
 * One-off repair: apply projected canonical temporal fields.
 *
 * Usage:
 *   npx tsx scripts/repair-event-dates.ts --dry-run
 *   npx tsx scripts/repair-event-dates.ts --apply --bucket=auto_safe
 *   npx tsx scripts/repair-event-dates.ts --apply --ids-file=reports/ids.txt
 *   npx tsx scripts/repair-event-dates.ts --out=reports/repair-log.json
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  projectRepairFromLegacyRow,
  temporalFieldsForPrisma,
} from '../src/lib/eventTemporal';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

type RepairLogEntry = {
  id: string;
  title: string;
  bucket: string;
  before: {
    temporalKind: string;
    start: string;
    end: string;
    timezone: string | null;
    allDayStartDate: string | null;
    allDayEndDate: string | null;
  };
  after: {
    temporalKind: string;
    start: string;
    end: string;
    timezone: string | null;
    allDayStartDate: string | null;
    allDayEndDate: string | null;
  };
  applied: boolean;
};

function parseArgs(argv: string[]) {
  let apply = false;
  let bucket: 'auto_safe' | 'all_repairable' | null = null;
  let idsFile: string | null = null;
  let out = resolve(
    process.cwd(),
    'reports',
    `repair-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  for (const a of argv) {
    if (a === '--apply') apply = true;
    if (a === '--dry-run') apply = false;
    if (a.startsWith('--bucket=')) {
      const b = a.slice('--bucket='.length);
      if (b === 'auto_safe' || b === 'all_repairable') bucket = b;
    }
    if (a.startsWith('--ids-file=')) idsFile = resolve(a.slice('--ids-file='.length));
    if (a.startsWith('--out=')) out = resolve(a.slice('--out='.length));
  }

  return { apply, bucket, idsFile, out };
}

function snapshot(event: {
  temporalKind: string;
  start: Date;
  end: Date;
  timezone: string | null;
  allDayStartDate: Date | null;
  allDayEndDate: Date | null;
}) {
  return {
    temporalKind: event.temporalKind,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    timezone: event.timezone,
    allDayStartDate: event.allDayStartDate?.toISOString() ?? null,
    allDayEndDate: event.allDayEndDate?.toISOString() ?? null,
  };
}

async function main() {
  const { apply, bucket, idsFile, out } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  let idFilter: Set<string> | null = null;
  if (idsFile) {
    const raw = readFileSync(idsFile, 'utf8');
    idFilter = new Set(
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    );
  }

  const events = await prisma.event.findMany({ orderBy: { start: 'asc' } });
  const log: RepairLogEntry[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    if (idFilter && !idFilter.has(event.id)) continue;

    const projected = projectRepairFromLegacyRow(event);

    const repairable =
      projected.repairBucket === 'auto_safe' ||
      (bucket === 'all_repairable' &&
        projected.repairBucket !== 'needs_review' &&
        (projected.needsStorageRepair || projected.repairBucket === 'auto_safe'));

    if (!repairable) {
      skippedCount++;
      continue;
    }

    if (bucket === 'auto_safe' && projected.repairBucket !== 'auto_safe') {
      skippedCount++;
      continue;
    }

    const temporal = temporalFieldsForPrisma(projected);
    const before = snapshot(event);
    const after = {
      temporalKind: temporal.temporalKind,
      start: temporal.start.toISOString(),
      end: temporal.end.toISOString(),
      timezone: temporal.timezone,
      allDayStartDate: temporal.allDayStartDate?.toISOString() ?? null,
      allDayEndDate: temporal.allDayEndDate?.toISOString() ?? null,
    };

    const unchanged =
      before.temporalKind === after.temporalKind &&
      before.start === after.start &&
      before.end === after.end &&
      before.timezone === after.timezone &&
      before.allDayStartDate === after.allDayStartDate &&
      before.allDayEndDate === after.allDayEndDate;

    if (unchanged) {
      skippedCount++;
      continue;
    }

    if (apply) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          ...temporal,
          dateRepairedAt: new Date(),
          gcalSyncPending: event.status === 'PUBLISHED' ? true : undefined,
        },
      });
      appliedCount++;
    }

    log.push({
      id: event.id,
      title: event.title,
      bucket: projected.repairBucket,
      before,
      after,
      applied: apply,
    });

    console.log(
      `${apply ? 'REPAIRED' : 'WOULD REPAIR'} [${projected.repairBucket}] ${event.id} ${event.title}`
    );
  }

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apply,
        bucket,
        appliedCount,
        skippedCount,
        log,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nLog written -> ${out}`);
  console.log(
    `${apply ? 'Applied' : 'Would apply'} ${log.length} repairs (${appliedCount} written, ${skippedCount} skipped).`
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
