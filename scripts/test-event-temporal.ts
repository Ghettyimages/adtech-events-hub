/**
 * Lightweight tests for eventTemporal (run: npm run test:event-temporal)
 */

import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  TEMPORAL_KIND,
  allDayInstantsFromCivilDates,
  civilDayKeyInZone,
  coerceHubEventTimezone,
  fromCsvRow,
  normalizeEventForWrite,
  repairHubTimedTemporal,
  storedTemporalEquals,
  toCsvRow,
  toGoogleCalendarPayload,
  utcInstantToWallClockDateTime,
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
  assert.equal(payload.start.dateTime, '2026-07-29T19:00:00');
  assert.equal(payload.end.dateTime, '2026-07-29T21:00:00');
  assert.ok(!payload.start.dateTime!.endsWith('Z'));
}

function testCannesAfternoonGooglePayload() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-06-22T14:00',
    end: '2026-06-22T14:45',
    timezone: 'Europe/Paris',
  });

  assert.equal(normalized.start.toISOString(), '2026-06-22T12:00:00.000Z');

  const payload = toGoogleCalendarPayload({
    temporalKind: normalized.temporalKind,
    start: normalized.start,
    end: normalized.end,
    timezone: normalized.timezone,
    allDayStartDate: null,
    allDayEndDate: null,
  });

  assert.equal(payload.start.dateTime, '2026-06-22T14:00:00');
  assert.equal(payload.end.dateTime, '2026-06-22T14:45:00');
  assert.equal(payload.start.timeZone, 'Europe/Paris');
}

function testHubTimezoneCoercion() {
  const coerced = coerceHubEventTimezone('America/New_York', 'Europe/Paris');
  assert.equal(coerced.timezone, 'Europe/Paris');
  assert.equal(coerced.wasOverwritten, true);
}

function testCivilDayInParis() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-06-22T23:30',
    end: '2026-06-23T00:30',
    timezone: 'Europe/Paris',
  });
  const dayKey = civilDayKeyInZone(normalized.start, 'Europe/Paris');
  assert.equal(dayKey, '2026-06-22');
}

function testRepairHubTimedFromWrongZone() {
  const wrong = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-06-22T14:00',
    end: '2026-06-22T15:00',
    timezone: 'America/New_York',
  });

  const repaired = repairHubTimedTemporal(wrong, 'Europe/Paris', 'America/New_York');
  assert.equal(
    utcInstantToWallClockDateTime(repaired.start, 'Europe/Paris'),
    '2026-06-22T14:00:00'
  );
}

function testStoredTemporalEqualsIdempotent() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-06-22T14:00',
    end: '2026-06-22T15:00',
    timezone: 'Europe/Paris',
  });
  assert.equal(
    storedTemporalEquals(
      {
        temporalKind: normalized.temporalKind,
        start: normalized.start,
        end: normalized.end,
        timezone: normalized.timezone,
        allDayStartDate: null,
        allDayEndDate: null,
      },
      normalized
    ),
    true
  );
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
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-03-08T01:30',
    end: '2026-03-08T03:30',
    timezone: 'America/New_York',
  });

  const endUtc = DateTime.fromJSDate(normalized.end, { zone: 'utc' });
  const startUtc = DateTime.fromJSDate(normalized.start, { zone: 'utc' });
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
  testCannesAfternoonGooglePayload();
  testHubTimezoneCoercion();
  testCivilDayInParis();
  testRepairHubTimedFromWrongZone();
  testStoredTemporalEqualsIdempotent();
  testCsvRoundTrip();
  testDstBoundary();
  console.log('All eventTemporal tests passed.');
}

run();
