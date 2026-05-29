/**
 * Lightweight tests for eventTemporal (run: npx tsx scripts/test-event-temporal.ts)
 */

import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  TEMPORAL_KIND,
  allDayInstantsFromCivilDates,
  fromCsvRow,
  normalizeEventForWrite,
  toCsvRow,
  toGoogleCalendarPayload,
  violatesAllDayStorageContract,
} from '../src/lib/eventTemporal';

function testAllDayInvariant() {
  const { start, end } = allDayInstantsFromCivilDates('2026-07-29', '2026-07-31');
  assert.equal(violatesAllDayStorageContract(start, end), false);
  assert.equal(start.toISOString(), '2026-07-29T12:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-31T22:00:00.000Z');
}

function testTimedEtEveningGooglePayload() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-07-29T19:00',
    end: '2026-07-29T21:00',
    timezone: 'America/New_York',
  });

  const payload = toGoogleCalendarPayload({
    temporalKind: normalized.temporalKind,
    start: normalized.start,
    end: normalized.end,
    timezone: normalized.timezone,
    allDayStartDate: null,
    allDayEndDate: null,
  });

  assert.ok(payload.start.dateTime);
  assert.ok(payload.end.dateTime);
  assert.equal(payload.start.timeZone, 'America/New_York');

  const startEt = DateTime.fromISO(payload.start.dateTime!, { zone: 'utc' }).setZone(
    'America/New_York'
  );
  assert.equal(startEt.toFormat('yyyy-MM-dd'), '2026-07-29');
  assert.equal(startEt.hour, 19);
}

function testCsvRoundTrip() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.ALL_DAY,
    start: '2026-07-29',
    end: '2026-07-29',
    timezone: null,
  });

  const row = toCsvRow({
    id: 'test',
    title: 'Test',
    temporalKind: normalized.temporalKind,
    start: normalized.start,
    end: normalized.end,
    timezone: normalized.timezone,
    allDayStartDate: normalized.allDayStartDate,
    allDayEndDate: normalized.allDayEndDate,
  } as Parameters<typeof toCsvRow>[0]);

  assert.equal(row.all_day, 'true');
  assert.equal(row.start, '2026-07-29');
  assert.equal(row.end, '2026-07-29');

  const input = fromCsvRow(row);
  const again = normalizeEventForWrite(input);
  assert.equal(again.start.toISOString(), normalized.start.toISOString());
  assert.equal(again.end.toISOString(), normalized.end.toISOString());
}

function testDstBoundary() {
  // Spring forward 2026-03-08 in America/New_York
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-03-08T01:30',
    end: '2026-03-08T03:30',
    timezone: 'America/New_York',
  });

  const startUtc = DateTime.fromJSDate(normalized.start, { zone: 'utc' });
  const endUtc = DateTime.fromJSDate(normalized.end, { zone: 'utc' });
  assert.ok(endUtc > startUtc);
  assert.equal(
    DateTime.fromJSDate(normalized.start, { zone: 'America/New_York' }).toFormat(
      'yyyy-MM-dd HH:mm'
    ),
    '2026-03-08 01:30'
  );
}

function run() {
  testAllDayInvariant();
  testTimedEtEveningGooglePayload();
  testCsvRoundTrip();
  testDstBoundary();
  console.log('All eventTemporal tests passed.');
}

run();
