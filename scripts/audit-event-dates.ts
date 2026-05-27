/**
 * Read-only audit: every Event row with current temporal fields vs a projected "new model"
 * for later comparison and one-off repair.
 *
 * Usage:
 *   npx tsx scripts/audit-event-dates.ts
 *   npx tsx scripts/audit-event-dates.ts --out=reports/event-date-audit.json
 *   npx tsx scripts/audit-event-dates.ts --format=csv --out=reports/event-date-audit.csv
 *
 * Requires DATABASE_URL (same as other scripts). Loads .env when present (dotenv).
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Papa from 'papaparse';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

function formatDateYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Matches current convertEventToGoogleCalendar (all-day date fields from UTC calendar day of instants). */
function currentGoogleAllDayPayload(start: Date, end: Date): { startDate: string; endExclusive: string } {
  const exclusiveEnd = new Date(end);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return {
    startDate: formatDateYmdUtc(start),
    endExclusive: formatDateYmdUtc(exclusiveEnd),
  };
}

function isAllDayInApp(timezone: string | null | undefined): boolean {
  return timezone == null || String(timezone).trim() === '';
}

/** ALL_DAY storage contract: start 12:00 UTC, end 22:00 UTC on inclusive civil days (UTC date components). */
function violatesAllDayContract(start: Date, end: Date): boolean {
  const okStart =
    start.getUTCHours() === 12 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0;
  const okEnd =
    end.getUTCHours() === 22 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0;
  return !(okStart && okEnd);
}

type AuditRow = {
  id: string;
  title: string;
  status: string;
  /** How the app treats the row today (timezone null/empty => all-day UI). */
  current_app_all_day: boolean;
  current_timezone: string;
  current_start_iso: string;
  current_end_iso: string;
  current_utc_start_date: string;
  current_utc_end_date: string;
  current_google_all_day_start: string;
  current_google_all_day_end_exclusive: string;
  current_violates_allday_storage_contract: boolean;
  /** TIMED in DB but Google sync still uses all-day `date` derived from UTC (known bug class). */
  current_timed_but_google_uses_allday_dates: boolean;

  /** Projected after long-term model: explicit kind. */
  new_temporal_kind: 'ALL_DAY' | 'TIMED';
  new_all_day_start_date: string | null;
  new_all_day_end_date_inclusive: string | null;
  new_normalized_start_iso: string | null;
  new_normalized_end_iso: string | null;
  /** Google under new rules: ALL_DAY => date + exclusive end; TIMED => use dateTime (shown as summary fields). */
  new_google_mode: 'ALL_DAY_DATE' | 'TIMED_DATETIME';
  new_google_all_day_start: string | null;
  new_google_all_day_end_exclusive: string | null;
  new_google_timed_start_iso: string | null;
  new_google_timed_end_iso: string | null;

  new_storage_start_differs_from_current: boolean;
  new_storage_end_differs_from_current: boolean;
  new_google_start_differs_from_current: boolean;
  new_google_end_exclusive_differs_from_current: boolean;
  /** True when TIMED (sync would switch to dateTime) or ALL_DAY when normalized storage/Google dates differ from today. */
  new_google_export_semantics_change: boolean;
};

function projectNewModel(event: {
  start: Date;
  end: Date;
  timezone: string | null;
}): Omit<
  AuditRow,
  | 'id'
  | 'title'
  | 'status'
  | 'current_app_all_day'
  | 'current_timezone'
  | 'current_start_iso'
  | 'current_end_iso'
  | 'current_utc_start_date'
  | 'current_utc_end_date'
  | 'current_google_all_day_start'
  | 'current_google_all_day_end_exclusive'
  | 'current_violates_allday_storage_contract'
  | 'current_timed_but_google_uses_allday_dates'
> {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const timed = !isAllDayInApp(event.timezone);

  if (timed) {
    return {
      new_temporal_kind: 'TIMED',
      new_all_day_start_date: null,
      new_all_day_end_date_inclusive: null,
      new_normalized_start_iso: null,
      new_normalized_end_iso: null,
      new_google_mode: 'TIMED_DATETIME',
      new_google_all_day_start: null,
      new_google_all_day_end_exclusive: null,
      new_google_timed_start_iso: start.toISOString(),
      new_google_timed_end_iso: end.toISOString(),
      new_storage_start_differs_from_current: false,
      new_storage_end_differs_from_current: false,
      new_google_start_differs_from_current: false,
      new_google_end_exclusive_differs_from_current: false,
      new_google_export_semantics_change: true,
    };
  }

  const sy = start.getUTCFullYear();
  const sm = start.getUTCMonth();
  const sd = start.getUTCDate();
  const ey = end.getUTCFullYear();
  const em = end.getUTCMonth();
  const ed = end.getUTCDate();

  const normStart = new Date(Date.UTC(sy, sm, sd, 12, 0, 0, 0));
  const normEnd = new Date(Date.UTC(ey, em, ed, 22, 0, 0, 0));

  const startYmd = formatDateYmdUtc(normStart);
  const endYmd = formatDateYmdUtc(normEnd);
  const newGoogle = currentGoogleAllDayPayload(normStart, normEnd);

  const cur = currentGoogleAllDayPayload(start, end);

  const storageStartDiffers = normStart.getTime() !== start.getTime();
  const storageEndDiffers = normEnd.getTime() !== end.getTime();
  const googleStartDiffers = newGoogle.startDate !== cur.startDate;
  const googleEndDiffers = newGoogle.endExclusive !== cur.endExclusive;

  return {
    new_temporal_kind: 'ALL_DAY',
    new_all_day_start_date: startYmd,
    new_all_day_end_date_inclusive: endYmd,
    new_normalized_start_iso: normStart.toISOString(),
    new_normalized_end_iso: normEnd.toISOString(),
    new_google_mode: 'ALL_DAY_DATE',
    new_google_all_day_start: newGoogle.startDate,
    new_google_all_day_end_exclusive: newGoogle.endExclusive,
    new_google_timed_start_iso: null,
    new_google_timed_end_iso: null,
    new_storage_start_differs_from_current: storageStartDiffers,
    new_storage_end_differs_from_current: storageEndDiffers,
    new_google_start_differs_from_current: googleStartDiffers,
    new_google_end_exclusive_differs_from_current: googleEndDiffers,
    new_google_export_semantics_change:
      storageStartDiffers || storageEndDiffers || googleStartDiffers || googleEndDiffers,
  };
}

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
    const appAllDay = isAllDayInApp(event.timezone);
    const curGoogle = currentGoogleAllDayPayload(start, end);
    const violates = appAllDay && violatesAllDayContract(start, end);
    const timedButGoogleAllday = !appAllDay;

    const projected = projectNewModel({
      start,
      end,
      timezone: event.timezone,
    });

    return {
      id: event.id,
      title: event.title,
      status: event.status,
      current_app_all_day: appAllDay,
      current_timezone: event.timezone ?? '',
      current_start_iso: start.toISOString(),
      current_end_iso: end.toISOString(),
      current_utc_start_date: formatDateYmdUtc(start),
      current_utc_end_date: formatDateYmdUtc(end),
      current_google_all_day_start: curGoogle.startDate,
      current_google_all_day_end_exclusive: curGoogle.endExclusive,
      current_violates_allday_storage_contract: violates,
      current_timed_but_google_uses_allday_dates: timedButGoogleAllday,

      ...projected,
    };
  });

  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (format === 'json') {
    const payload = {
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      summary: {
        timed_events_count: rows.filter((r) => r.new_temporal_kind === 'TIMED').length,
        timed_events_google_sync_would_use_datetime: rows.filter((r) => r.new_temporal_kind === 'TIMED').length,
        all_day_contract_violations: rows.filter((r) => r.current_violates_allday_storage_contract).length,
        all_day_rows_storage_would_normalize: rows.filter(
          (r) =>
            r.new_temporal_kind === 'ALL_DAY' &&
            (r.new_storage_start_differs_from_current || r.new_storage_end_differs_from_current)
        ).length,
        all_day_rows_google_allday_dates_would_change: rows.filter(
          (r) =>
            r.new_temporal_kind === 'ALL_DAY' &&
            (r.new_google_start_differs_from_current || r.new_google_end_exclusive_differs_from_current)
        ).length,
        rows_with_any_google_export_semantics_change: rows.filter((r) => r.new_google_export_semantics_change)
          .length,
      },
      rows,
    };
    writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  } else {
    const csv = Papa.unparse(rows);
    writeFileSync(out, csv, 'utf8');
  }

  console.log(`Wrote ${format.toUpperCase()} audit (${rows.length} events) -> ${out}`);
  const timed = rows.filter((r) => r.new_temporal_kind === 'TIMED').length;
  const violations = rows.filter((r) => r.current_violates_allday_storage_contract).length;
  const storageChange = rows.filter(
    (r) => r.new_storage_start_differs_from_current || r.new_storage_end_differs_from_current
  ).length;
  const semanticsChange = rows.filter((r) => r.new_google_export_semantics_change).length;
  console.log(`Summary: TIMED rows=${timed}, ALL_DAY contract violations=${violations}`);
  console.log(`Summary: rows where normalized storage would differ=${storageChange}`);
  console.log(`Summary: rows where Google export semantics would change=${semanticsChange}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
