/**
 * Repair festival hub event temporal fields (default: cannes-2026).
 *
 * Fixes:
 * - Missing/wrong timezone → hub timezone (Europe/Paris)
 * - Misclassified ALL_DAY timed sessions
 * - Timed events stored under wrong zone (reinterpret wall-clock into hub zone)
 *
 * Usage:
 *   npx tsx scripts/repair-cannes-hub-dates.ts --dry-run
 *   npx tsx scripts/repair-cannes-hub-dates.ts --apply
 *   npx tsx scripts/repair-cannes-hub-dates.ts --hub=cannes-2026 --apply
 */

import './load-env';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DEFAULT_TIMED_ZONE,
  FESTIVAL_HUB_DEFAULT_ZONE,
  isAllDayEvent,
  projectRepairFromLegacyRow,
  repairHubTimedTemporal,
  storedTemporalEquals,
  temporalFieldsForPrisma,
} from '../src/lib/eventTemporal';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

type RepairAction = 'timezone_fixup' | 'allday_repair' | 'timed_zone_reinterpret' | 'storage_repair' | 'skip';

type RepairLogEntry = {
  id: string;
  title: string;
  status: string;
  action: RepairAction;
  reason: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  applied: boolean;
};

function parseArgs(argv: string[]) {
  let apply = false;
  let hubSlug = 'cannes-2026';
  let out = resolve(
    process.cwd(),
    'reports',
    `repair-cannes-hub-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  for (const a of argv) {
    if (a === '--apply') apply = true;
    if (a === '--dry-run') apply = false;
    if (a.startsWith('--hub=')) hubSlug = a.slice('--hub='.length);
    if (a.startsWith('--out=')) out = resolve(a.slice('--out='.length));
  }

  return { apply, hubSlug, out };
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

function hasClockTime(start: Date, end: Date): boolean {
  const startHasTime =
    start.getUTCHours() !== 12 || start.getUTCMinutes() !== 0 || start.getUTCMilliseconds() !== 0;
  const endHasTime =
    end.getUTCHours() !== 22 || end.getUTCMinutes() !== 0 || end.getUTCMilliseconds() !== 0;
  return startHasTime || endHasTime;
}

async function main() {
  const { apply, hubSlug, out } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const hub = await prisma.eventHub.findUnique({
    where: { slug: hubSlug },
    select: { id: true, name: true, timezone: true },
  });

  if (!hub) {
    console.error(`Hub not found: ${hubSlug}`);
    process.exit(1);
  }

  const hubTimezone = hub.timezone?.trim() || FESTIVAL_HUB_DEFAULT_ZONE;

  const events = await prisma.event.findMany({
    where: { hubId: hub.id },
    orderBy: { start: 'asc' },
  });

  console.log(`Hub: ${hub.name} (${hubSlug}) — timezone: ${hubTimezone}`);
  console.log(`Events: ${events.length} — mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  const log: RepairLogEntry[] = [];
  let wouldChange = 0;
  let applied = 0;

  for (const event of events) {
    const before = snapshot(event);
    let action: RepairAction = 'skip';
    let reason = 'No change needed';
    let normalized = null;

    const isAllDay = isAllDayEvent(event);
    const tzWrong = (event.timezone?.trim() || '') !== hubTimezone;
    const timedMisclassified = isAllDay && hasClockTime(new Date(event.start), new Date(event.end));

    if (timedMisclassified) {
      action = 'timed_zone_reinterpret';
      reason = 'Timed session misclassified as ALL_DAY';
      normalized = repairHubTimedTemporal(event, hubTimezone, event.timezone || DEFAULT_TIMED_ZONE);
    } else if (!isAllDay && tzWrong) {
      action = 'timezone_fixup';
      reason = `Timezone ${event.timezone ?? '(null)'} → ${hubTimezone}`;
      normalized = repairHubTimedTemporal(
        event,
        hubTimezone,
        event.timezone || DEFAULT_TIMED_ZONE
      );
    } else {
      const projection = projectRepairFromLegacyRow(event);
      if (projection.repairBucket === 'needs_review') {
        action = 'skip';
        reason = 'Needs manual review (midnight UTC ingest)';
      } else if (projection.needsStorageRepair) {
        action = 'storage_repair';
        reason = 'Storage contract / civil date repair';
        normalized = {
          temporalKind: projection.temporalKind,
          start: projection.start,
          end: projection.end,
          timezone: projection.timezone,
          allDayStartDate: projection.allDayStartDate,
          allDayEndDate: projection.allDayEndDate,
        };
      }
    }

    if (!normalized) {
      log.push({
        id: event.id,
        title: event.title,
        status: event.status,
        action,
        reason,
        before,
        after: before,
        applied: false,
      });
      continue;
    }

    if (storedTemporalEquals(event, normalized)) {
      log.push({
        id: event.id,
        title: event.title,
        status: event.status,
        action: 'skip',
        reason: 'Normalized matches stored',
        before,
        after: before,
        applied: false,
      });
      continue;
    }

    wouldChange++;
    const after = {
      temporalKind: normalized.temporalKind,
      start: normalized.start.toISOString(),
      end: normalized.end.toISOString(),
      timezone: normalized.timezone,
      allDayStartDate: normalized.allDayStartDate?.toISOString() ?? null,
      allDayEndDate: normalized.allDayEndDate?.toISOString() ?? null,
    };

    let didApply = false;
    if (apply) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          ...temporalFieldsForPrisma(normalized),
          dateRepairedAt: new Date(),
        },
      });
      didApply = true;
      applied++;
    }

    log.push({
      id: event.id,
      title: event.title,
      status: event.status,
      action,
      reason,
      before,
      after,
      applied: didApply,
    });
  }

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        hubSlug,
        hubTimezone,
        mode: apply ? 'apply' : 'dry-run',
        total: events.length,
        wouldChange,
        applied,
        entries: log,
      },
      null,
      2
    )
  );

  console.log(`Would change: ${wouldChange}`);
  console.log(`Applied: ${applied}`);
  console.log(`Report: ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
