/**
 * Read-only audit: every Event row with current temporal fields vs projected repair model.
 *
 * Usage:
 *   npx tsx scripts/audit-event-dates.ts
 *   npx tsx scripts/audit-event-dates.ts --out=reports/event-date-audit.json
 *   npx tsx scripts/audit-event-dates.ts --format=csv --out=reports/event-date-audit.csv
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Papa from 'papaparse';
import {
  formatYmdUtc,
  isAllDayEvent,
  projectRepairFromLegacyRow,
  toGoogleCalendarPayload,
  violatesAllDayStorageContract,
  TEMPORAL_KIND,
} from '../src/lib/eventTemporal';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

function legacyGoogleAllDayPayload(start: Date, end: Date): {
  startDate: string;
  endExclusive: string;
} {
  const exclusiveEnd = new Date(end);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return {
    startDate: formatYmdUtc(start),
    endExclusive: formatYmdUtc(exclusiveEnd),
  };
}

type AuditRow = {
  id: string;
  title: string;
  status: string;
  current_temporal_kind: string;
  current_app_all_day: boolean;
  current_timezone: string;
  current_start_iso: string;
  current_end_iso: string;
  current_utc_start_date: string;
  current_utc_end_date: string;
  current_google_all_day_start: string;
  current_google_all_day_end_exclusive: string;
  current_violates_allday_storage_contract: boolean;
  current_timed_but_google_uses_allday_dates: boolean;

  projected_temporal_kind: string;
  projected_all_day_start_date: string | null;
  projected_all_day_end_date_inclusive: string | null;
  projected_start_iso: string;
  projected_end_iso: string;
  projected_google_mode: 'ALL_DAY_DATE' | 'TIMED_DATETIME';
  projected_google_all_day_start: string | null;
  projected_google_all_day_end_exclusive: string | null;
  projected_google_timed_start_iso: string | null;
  projected_google_timed_end_iso: string | null;

  needs_storage_repair: boolean;
  needs_review: boolean;
  export_semantics_change: boolean;
  repair_bucket: string;

  storage_start_differs: boolean;
  storage_end_differs: boolean;
  google_start_differs: boolean;
  google_end_exclusive_differs: boolean;
};

function parseArgs(argv: string[]): { out: string; format: 'json' | 'csv' } {
  let out = resolve(process.cwd(), 'reports', 'event-date-audit.json');
  let format: 'json' | 'csv' = 'json';
  for (const a of argv) {
    if (a.startsWith('--out=')) out = resolve(a.slice('--out='.length));
    if (a.startsWith('--format=')) {
      const f = a.slice('--format='.length).toLowerCase();
      if (f === 'csv' || f === 'json') format = f;
    }
  }
  if (format === 'csv' && out.endsWith('.json')) {
    out = out.replace(/\.json$/i, '.csv');
  }
  return { out, format };
}

async function main() {
  const { out, format } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env or the environment.');
    process.exit(1);
  }

  const events = await prisma.event.findMany({
    orderBy: { start: 'asc' },
  });

  const rows: AuditRow[] = events.map((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const appAllDay = isAllDayEvent(event);
    const curGoogle = legacyGoogleAllDayPayload(start, end);
    const violates =
      appAllDay && violatesAllDayStorageContract(start, end);
    const timedButGoogleAllday = !appAllDay;

    const projected = projectRepairFromLegacyRow(event);
    const newGoogle = toGoogleCalendarPayload({
      ...event,
      start: projected.start,
      end: projected.end,
      temporalKind: projected.temporalKind,
      allDayStartDate: projected.allDayStartDate,
      allDayEndDate: projected.allDayEndDate,
      timezone: projected.timezone,
    });

    const storageStartDiffers = projected.start.getTime() !== start.getTime();
    const storageEndDiffers = projected.end.getTime() !== end.getTime();

    let projectedGoogleMode: AuditRow['projected_google_mode'] = 'TIMED_DATETIME';
    let projectedGoogleAllDayStart: string | null = null;
    let projectedGoogleAllDayEndExclusive: string | null = null;
    let projectedGoogleTimedStart: string | null = null;
    let projectedGoogleTimedEnd: string | null = null;

    if (projected.temporalKind === TEMPORAL_KIND.ALL_DAY) {
      projectedGoogleMode = 'ALL_DAY_DATE';
      projectedGoogleAllDayStart = newGoogle.start.date ?? null;
      projectedGoogleAllDayEndExclusive = newGoogle.end.date ?? null;
    } else {
      projectedGoogleTimedStart = newGoogle.start.dateTime ?? null;
      projectedGoogleTimedEnd = newGoogle.end.dateTime ?? null;
    }

    const googleStartDiffers =
      projected.temporalKind === TEMPORAL_KIND.ALL_DAY
        ? (newGoogle.start.date ?? '') !== curGoogle.startDate
        : true;
    const googleEndDiffers =
      projected.temporalKind === TEMPORAL_KIND.ALL_DAY
        ? (newGoogle.end.date ?? '') !== curGoogle.endExclusive
        : true;

    return {
      id: event.id,
      title: event.title,
      status: event.status,
      current_temporal_kind: event.temporalKind,
      current_app_all_day: appAllDay,
      current_timezone: event.timezone ?? '',
      current_start_iso: start.toISOString(),
      current_end_iso: end.toISOString(),
      current_utc_start_date: formatYmdUtc(start),
      current_utc_end_date: formatYmdUtc(end),
      current_google_all_day_start: curGoogle.startDate,
      current_google_all_day_end_exclusive: curGoogle.endExclusive,
      current_violates_allday_storage_contract: violates,
      current_timed_but_google_uses_allday_dates: timedButGoogleAllday,

      projected_temporal_kind: projected.temporalKind,
      projected_all_day_start_date: projected.allDayStartDate
        ? formatYmdUtc(projected.allDayStartDate)
        : null,
      projected_all_day_end_date_inclusive: projected.allDayEndDate
        ? formatYmdUtc(projected.allDayEndDate)
        : null,
      projected_start_iso: projected.start.toISOString(),
      projected_end_iso: projected.end.toISOString(),
      projected_google_mode: projectedGoogleMode,
      projected_google_all_day_start: projectedGoogleAllDayStart,
      projected_google_all_day_end_exclusive: projectedGoogleAllDayEndExclusive,
      projected_google_timed_start_iso: projectedGoogleTimedStart,
      projected_google_timed_end_iso: projectedGoogleTimedEnd,

      needs_storage_repair: projected.needsStorageRepair,
      needs_review: projected.needsReview,
      export_semantics_change: projected.exportSemanticsChange,
      repair_bucket: projected.repairBucket,

      storage_start_differs: storageStartDiffers,
      storage_end_differs: storageEndDiffers,
      google_start_differs: googleStartDiffers,
      google_end_exclusive_differs: googleEndDiffers,
    };
  });

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const summary = {
    row_count: rows.length,
    timed_events: rows.filter((r) => r.projected_temporal_kind === TEMPORAL_KIND.TIMED)
      .length,
    all_day_contract_violations: rows.filter(
      (r) => r.current_violates_allday_storage_contract
    ).length,
    needs_storage_repair: rows.filter((r) => r.needs_storage_repair).length,
    needs_review: rows.filter((r) => r.needs_review).length,
    auto_safe_bucket: rows.filter((r) => r.repair_bucket === 'auto_safe').length,
    export_semantics_change: rows.filter((r) => r.export_semantics_change).length,
    storage_would_change: rows.filter(
      (r) => r.storage_start_differs || r.storage_end_differs
    ).length,
    google_export_would_change: rows.filter(
      (r) => r.google_start_differs || r.google_end_exclusive_differs
    ).length,
  };

  if (format === 'json') {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary,
      rows,
    };
    writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  } else {
    const csv = Papa.unparse(rows);
    writeFileSync(out, csv, 'utf8');
  }

  console.log(`Wrote ${format.toUpperCase()} audit (${rows.length} events) -> ${out}`);
  console.log('Summary:', JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
