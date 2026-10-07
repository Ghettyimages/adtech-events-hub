/**
 * Lightweight tests for eventTemporal (run: npm run test:event-temporal)
 */

import assert from 'node:assert/strict';
import Module from 'node:module';
import { DateTime } from 'luxon';
import {
  TEMPORAL_KIND,
  allDayInstantsFromCivilDates,
  civilDayKeyInZone,
  coerceHubEventTimezone,
  fromCsvRow,
  normalizeEventForWrite,
  temporalInputFromEventStrings,
  normalizeEventForHubIngest,
  repairHubTimedTemporal,
  storedTemporalEquals,
  toCsvRow,
  toGoogleCalendarPayload,
  utcInstantToWallClockDateTime,
  violatesAllDayStorageContract,
  DEFAULT_TIMED_ZONE,
  FESTIVAL_HUB_DEFAULT_ZONE,
} from '../src/lib/eventTemporal';
import { sanitizeScheduleWallClock } from '../src/lib/scheduleWallClock';
import { extractStrictDates, preferPageClockTimes } from '../src/lib/extractor/dateExtractor';

type RawAgentEvent = {
  title: string;
  dates: { start: string; end: string };
  location: string | null;
  link: string;
  source: string;
};

async function loadExtractorForTests() {
  const prototype = Module.prototype as unknown as {
    require: (id: string, ...args: unknown[]) => unknown;
  };
  const originalRequire = prototype.require;
  prototype.require = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    return originalRequire.call(this, id, ...args);
  };
  try {
    return await import('../src/lib/extractor/agent');
  } finally {
    prototype.require = originalRequire;
  }
}

async function extractFixture(rawEvent: RawAgentEvent, html: string) {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY ||= 'extractor-test-key';
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify([rawEvent]) } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  try {
    const { extractEventsFromUrl } = await loadExtractorForTests();
    const result = await extractEventsFromUrl('https://example.com/event', 'Test', html);
    assert.equal(result.events.length, 1);
    return result.events[0];
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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

/** Date-only scrape: 12:00Z/22:00Z placeholders must stay all-day on the ingest pass. */
function testAllDayPlaceholdersStayAllDayWhenHubZonePresent() {
  const first = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.ALL_DAY,
    start: '2026-10-01',
    end: '2026-10-01',
    timezone: null,
  });
  assert.equal(first.start.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(first.end.toISOString(), '2026-10-01T22:00:00.000Z');

  const secondInput = temporalInputFromEventStrings({
    start: first.start.toISOString(),
    end: first.end.toISOString(),
    temporalKind: first.temporalKind,
    hubTimezone: 'America/New_York',
  });
  assert.equal(secondInput.temporalKind, TEMPORAL_KIND.ALL_DAY);

  const second = normalizeEventForWrite({
    ...secondInput,
    timezone: secondInput.temporalKind === TEMPORAL_KIND.TIMED ? 'America/New_York' : null,
  });
  assert.equal(second.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(second.timezone, null);
  assert.equal(second.start.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(second.end.toISOString(), '2026-10-01T22:00:00.000Z');
}

/** A real noon-UTC instant (14:00 Paris) must stay timed across the same second pass. */
function testTimedNoonUtcStaysTimedOnSecondPass() {
  const first = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-06-22T14:00',
    end: '2026-06-22T14:45',
    timezone: 'Europe/Paris',
  });
  assert.equal(first.start.toISOString(), '2026-06-22T12:00:00.000Z');

  const secondInput = temporalInputFromEventStrings({
    start: first.start.toISOString(),
    end: first.end.toISOString(),
    timezone: first.timezone,
    temporalKind: first.temporalKind,
    hubTimezone: 'Europe/Paris',
  });
  const second = normalizeEventForWrite({
    ...secondInput,
    timezone: secondInput.temporalKind === TEMPORAL_KIND.TIMED ? 'Europe/Paris' : null,
  });
  assert.equal(second.temporalKind, TEMPORAL_KIND.TIMED);
  assert.equal(second.timezone, 'Europe/Paris');
  assert.equal(second.start.toISOString(), first.start.toISOString());
  assert.equal(second.end.toISOString(), first.end.toISOString());
}

function testPlaceholderInstantsWithoutZoneStayAllDay() {
  const input = fromCsvRow({
    start: '2026-10-01T12:00:00.000Z',
    end: '2026-10-01T22:00:00.000Z',
  });
  assert.equal(input.temporalKind, TEMPORAL_KIND.ALL_DAY);
}

function testSplashPageClockTime() {
  const html = `
    <html><body>
      Launch Party
      October 1
      10 / 01 / 2026
      6:00pm - 11:00pm
      New York, NY
      09/22/2026 7:30PM - 11:30PM
    </body></html>
  `;
  const dates = extractStrictDates(html);
  assert.equal(dates.date_status, 'confirmed');
  assert.equal(dates.start, '2026-10-01T18:00:00');
  assert.equal(dates.end, '2026-10-01T23:00:00');

  const replaced = preferPageClockTimes('2026-10-01T08:00:00', '2026-10-01T18:00:00', html);
  assert.equal(replaced?.start, '2026-10-01T18:00:00');
  assert.equal(replaced?.end, '2026-10-01T23:00:00');

  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: dates.start!,
    end: dates.end!,
    timezone: 'America/New_York',
  });
  assert.equal(
    utcInstantToWallClockDateTime(normalized.start, 'America/New_York'),
    '2026-10-01T18:00:00'
  );
  assert.equal(
    utcInstantToWallClockDateTime(normalized.end, 'America/New_York'),
    '2026-10-01T23:00:00'
  );
}

async function testExtractorTemporalEvidenceAuthority() {
  const baseRaw: RawAgentEvent = {
    title: 'Launch Party',
    dates: { start: 'Oct 01, 2026 8:00 AM', end: 'Oct 01, 2026 6:00 PM' },
    location: null,
    link: 'https://example.com/event',
    source: 'Test',
  };

  // 1. An explicit source-page range overrides unsupported agent clocks.
  const pageClock = await extractFixture(
    baseRaw,
    '<html><body><h1>Launch Party</h1><p>10/01/2026 6:00pm - 11:00pm</p></body></html>'
  );
  assert.equal(pageClock.start, '2026-10-01T18:00:00');
  assert.equal(pageClock.end, '2026-10-01T23:00:00');
  assert.equal(pageClock.temporalKind, TEMPORAL_KIND.TIMED);
  assert.equal(pageClock.date_status, 'confirmed');
  assert.equal(pageClock.evidence_context, 'visible-text');

  // 2. Source-confirmed structured clocks remain timed without a visible range.
  const structuredClock = await extractFixture(
    baseRaw,
    `<html><body><div>
      <h1>Launch Party</h1>
      <meta itemprop="startDate" content="2026-10-01T18:00:00-04:00">
      <meta itemprop="endDate" content="2026-10-01T23:00:00-04:00">
    </div></body></html>`
  );
  assert.equal(structuredClock.temporalKind, TEMPORAL_KIND.TIMED);
  assert.equal(structuredClock.date_status, 'confirmed');
  assert.equal(structuredClock.evidence_context, 'visible-text');
  assert.match(structuredClock.start!, /T/);
  assert.match(structuredClock.end!, /T/);

  // 3. A source-confirmed date with no clock is explicitly all-day.
  const sourceDateOnly = await extractFixture(
    {
      ...baseRaw,
      dates: { start: 'Oct 01, 2026', end: 'Oct 01, 2026' },
    },
    '<html><body><h1>Launch Party</h1><p>October 1, 2026</p></body></html>'
  );
  assert.equal(sourceDateOnly.start, '2026-10-01');
  assert.equal(sourceDateOnly.end, '2026-10-01');
  assert.equal(sourceDateOnly.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(sourceDateOnly.date_status, 'confirmed');
  assert.equal(sourceDateOnly.evidence_context, 'visible-text');

  // 4. Agent-only clocks lose their time component and never become confirmed.
  const unsupportedClock = await extractFixture(
    baseRaw,
    '<html><body><h1>Launch Party</h1><p>Full schedule coming soon.</p></body></html>'
  );
  assert.equal(unsupportedClock.start, '2026-10-01');
  assert.equal(unsupportedClock.end, '2026-10-01');
  assert.equal(unsupportedClock.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(unsupportedClock.date_status, 'tbd');
  assert.equal(unsupportedClock.evidence, undefined);
  assert.equal(unsupportedClock.evidence_context, 'agent');

  // 5. Agent-only date guesses remain unconfirmed all-day civil dates.
  const unsupportedDateOnly = await extractFixture(
    {
      ...baseRaw,
      dates: { start: 'Oct 01, 2026', end: 'Oct 01, 2026' },
    },
    '<html><body><h1>Launch Party</h1><p>Full schedule coming soon.</p></body></html>'
  );
  assert.equal(unsupportedDateOnly.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(unsupportedDateOnly.date_status, 'tbd');
  assert.equal(unsupportedDateOnly.evidence_context, 'agent');

  // 6. Multi-day preservation keeps only the agent end civil date, never its clock.
  const multiDay = await extractFixture(
    {
      ...baseRaw,
      dates: { start: 'Oct 01, 2026 8:00 AM', end: 'Oct 03, 2026 6:00 PM' },
    },
    '<html><body><h1>Launch Party</h1><p>October 1, 2026</p></body></html>'
  );
  assert.equal(multiDay.start, '2026-10-01');
  assert.equal(multiDay.end, '2026-10-03');
  assert.equal(multiDay.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(multiDay.date_status, 'confirmed');
  assert.equal(multiDay.evidence_context, 'visible-text');

  // 7. A source-backed start clock without an end clock remains all-day.
  const sourceStartClockOnly = await extractFixture(
    {
      ...baseRaw,
      dates: { start: 'Oct 01, 2026 6:00 PM', end: 'Oct 01, 2026 10:00 PM' },
    },
    '<html><body><h1>Launch Party</h1><p>October 1, 2026</p><p>Doors at 6:00 PM</p></body></html>'
  );
  assert.equal(sourceStartClockOnly.start, '2026-10-01');
  assert.equal(sourceStartClockOnly.end, '2026-10-01');
  assert.equal(sourceStartClockOnly.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(sourceStartClockOnly.date_status, 'confirmed');
  assert.equal(sourceStartClockOnly.evidence_context, 'visible-text');

  // 8. Mixed source-backed clock/date values normalize both bounds to civil dates.
  const mixedSourceValues = await extractFixture(
    baseRaw,
    `<html><body><h1>Launch Party</h1>
      <meta itemprop="startDate" content="2026-10-01T18:00:00-04:00">
      <meta itemprop="endDate" content="2026-10-01">
    </body></html>`
  );
  assert.equal(mixedSourceValues.start, '2026-10-01');
  assert.equal(mixedSourceValues.end, '2026-10-01');
  assert.equal(mixedSourceValues.temporalKind, TEMPORAL_KIND.ALL_DAY);
  assert.equal(mixedSourceValues.date_status, 'confirmed');
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

/** Main-calendar schedule paste: naive wall-clock in America/New_York. */
function testScheduleMainCalendarNyWallClock() {
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: '2026-09-15T14:00',
    end: '2026-09-15T15:00',
    timezone: DEFAULT_TIMED_ZONE,
  });
  assert.equal(normalized.timezone, 'America/New_York');
  assert.equal(
    utcInstantToWallClockDateTime(normalized.start, 'America/New_York'),
    '2026-09-15T14:00:00'
  );
  // EDT (UTC-4): 14:00 NY → 18:00 UTC
  assert.equal(normalized.start.toISOString(), '2026-09-15T18:00:00.000Z');
}

/** Hub schedule paste: same wall-clock digits coerced to Europe/Paris. */
function testScheduleHubParisWallClock() {
  const { normalized, timezoneOverwritten } = normalizeEventForHubIngest(
    {
      temporalKind: TEMPORAL_KIND.TIMED,
      start: '2026-06-22T14:00',
      end: '2026-06-22T14:45',
      timezone: 'America/New_York',
    },
    FESTIVAL_HUB_DEFAULT_ZONE
  );
  assert.equal(timezoneOverwritten, true);
  assert.equal(normalized.timezone, 'Europe/Paris');
  assert.equal(
    utcInstantToWallClockDateTime(normalized.start, 'Europe/Paris'),
    '2026-06-22T14:00:00'
  );
  // CEST (UTC+2): 14:00 Paris → 12:00 UTC
  assert.equal(normalized.start.toISOString(), '2026-06-22T12:00:00.000Z');
}

/** Schedule ingest sanitize: strip Z/offset, keep wall-clock digits. */
function testSanitizeScheduleWallClockStripsOffset() {
  assert.equal(
    sanitizeScheduleWallClock('2026-06-22T14:00:00Z', 'Europe/Paris'),
    '2026-06-22T14:00:00'
  );
  assert.equal(
    sanitizeScheduleWallClock('2026-06-22T14:00:00+02:00', 'Europe/Paris'),
    '2026-06-22T14:00:00'
  );
  assert.equal(
    sanitizeScheduleWallClock('2026-09-15T14:00:00', 'America/New_York'),
    '2026-09-15T14:00:00'
  );

  const sanitized = sanitizeScheduleWallClock(
    '2026-09-15T14:00:00Z',
    DEFAULT_TIMED_ZONE
  );
  const normalized = normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: sanitized,
    end: '2026-09-15T15:00:00',
    timezone: DEFAULT_TIMED_ZONE,
  });
  assert.equal(normalized.start.toISOString(), '2026-09-15T18:00:00.000Z');
}

async function run() {
  testAllDayInvariant();
  testTimedEtEveningGooglePayload();
  testCannesAfternoonGooglePayload();
  testHubTimezoneCoercion();
  testCivilDayInParis();
  testRepairHubTimedFromWrongZone();
  testStoredTemporalEqualsIdempotent();
  testCsvRoundTrip();
  testAllDayPlaceholdersStayAllDayWhenHubZonePresent();
  testPlaceholderInstantsWithoutZoneStayAllDay();
  testSplashPageClockTime();
  await testExtractorTemporalEvidenceAuthority();
  testTimedNoonUtcStaysTimedOnSecondPass();
  testDstBoundary();
  testScheduleMainCalendarNyWallClock();
  testScheduleHubParisWallClock();
  testSanitizeScheduleWallClockStripsOffset();
  console.log('All eventTemporal tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
