/**
 * Event Watch decision tests. Run: npm run test:event-watch
 * Fixtures only — these tests do not scrape a live site.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ExtractedEvent } from '../src/lib/extractor/schema';
import { fromCsvRow, normalizeEventForWrite } from '../src/lib/eventTemporal';
import { resolveDatabaseUrl } from '../src/lib/database-url';
import {
  EVENT_WATCH_CLAIM_STALE_MS,
  EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
  assignIdentities,
  buildCheckRecords,
  claimSource,
  decideExtractionSkip,
  decideProposalReview,
  extractRelevantContent,
  hashContent,
  isAbandonedScan,
  isDueForScheduledCheck,
  type BuildCheckInput,
  type CalendarEventSnapshot,
  type SourceCheckState,
} from '../src/lib/eventWatchLogic';

const NOW = new Date('2026-10-07T15:00:00.000Z');
const LISTING = 'https://events.example.com/agenda';

function extracted(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title: 'Industry Summit',
    start: '2026-11-02',
    end: '2026-11-02',
    location: 'New York, NY',
    url: 'https://events.example.com/summit',
    description: 'A gathering of media teams.',
    date_status: 'confirmed',
    location_status: 'confirmed',
    temporalKind: 'ALL_DAY',
    ...overrides,
  };
}

function source(overrides: Partial<SourceCheckState> = {}): SourceCheckState {
  return {
    id: 'source-1',
    url: LISTING,
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000,
    monitoringEndsAt: null,
    failureCount: 0,
    processedContentHash: null,
    lastFullScanAt: null,
    fullVerificationIntervalMs: EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
    requiresBrowser: false,
    monitorDetailPages: false,
    scanClaimedAt: null,
    nextCheckAt: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  };
}

function calendarFrom(event: ExtractedEvent, id = 'event-1', updatedAt = new Date('2026-10-01T00:00:00.000Z')): CalendarEventSnapshot {
  const temporal = normalizeEventForWrite(
    fromCsvRow({
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      temporal_kind: event.temporalKind,
    })
  );
  return {
    id,
    title: event.title.trim().replace(/\s+/g, ' '),
    description: event.description || null,
    url: event.url || null,
    location: event.location || null,
    city: event.city || null,
    region: event.region || null,
    country: event.country || null,
    start: temporal.start,
    end: temporal.end,
    timezone: temporal.timezone,
    temporalKind: temporal.temporalKind,
    allDayStartDate: temporal.allDayStartDate,
    allDayEndDate: temporal.allDayEndDate,
    updatedAt,
    status: 'PUBLISHED',
    sponsoredBy: 'Keep me',
  };
}

function check(overrides: Partial<BuildCheckInput> & Pick<BuildCheckInput, 'extraction'>): BuildCheckInput {
  return {
    now: NOW,
    trigger: 'MANUAL',
    source: source(),
    httpStatus: 200,
    conditionalValidatorsSent: false,
    contentHash: 'fetched-hash',
    browserContentHash: null,
    detailHashesMatch: true,
    fetchedEtag: null,
    fetchedLastModified: null,
    partial: false,
    calendarEvents: [],
    identities: [],
    latestPayloadByKey: {},
    proposals: [],
    candidates: [],
    existingIdentityStarts: [],
    ...overrides,
  };
}

function testBaselineAndNewEvent() {
  const event = extracted();
  const calendar = calendarFrom(event);
  const baseline = buildCheckRecords(
    check({
      extraction: { ok: true, events: [event], method: 'fixture' },
      calendarEvents: [calendar],
    })
  );
  assert.equal(baseline.baselinesEstablished, 1);
  assert.equal(baseline.proposals.length, 0);
  assert.equal(baseline.pendingEvents.length, 0);
  assert.equal(baseline.summary, 'Baseline established');
  assert.equal(baseline.advanceProcessedBaseline, true);

  const created = buildCheckRecords(
    check({
      extraction: {
        ok: true,
        events: [extracted({ title: 'Brand New Forum', url: 'https://events.example.com/forum' })],
        method: 'fixture',
      },
    })
  );
  assert.equal(created.newEvents, 1);
  assert.equal(created.pendingEvents.length, 1);
  assert.equal(created.candidates.length, 1);
  assert.equal(created.candidates[0].matchStatus, 'NEW_EVENT');
}

function testSkipAndFailure() {
  const recent = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  const watched = source({
    processedContentHash: 'same-hash',
    lastFullScanAt: recent,
  });
  const unchanged = buildCheckRecords(
    check({
      source: watched,
      contentHash: 'same-hash',
      extraction: { ok: true, events: [extracted({ title: 'Should not be created' })], method: 'fixture' },
    })
  );
  assert.equal(unchanged.fullExtractionRan, false);
  assert.equal(unchanged.summary, 'No changes found');
  assert.equal(unchanged.newEvents, 0);
  assert.match(unchanged.skipReason || '', /matches the last successful check/);

  const notModified = buildCheckRecords(
    check({
      source: watched,
      httpStatus: 304,
      conditionalValidatorsSent: true,
      contentHash: null,
      extraction: null,
    })
  );
  assert.equal(notModified.summary, 'No changes found');
  assert.equal(notModified.fullExtractionRan, false);

  const notModifiedWithoutBaseline = buildCheckRecords(
    check({
      source: source({ lastFullScanAt: recent, processedContentHash: null }),
      httpStatus: 304,
      conditionalValidatorsSent: true,
      extraction: null,
    })
  );
  assert.notEqual(notModifiedWithoutBaseline.summary, 'No changes found');
  assert.equal(notModifiedWithoutBaseline.advanceProcessedBaseline, false);

  const failed = buildCheckRecords(
    check({
      source: watched,
      contentHash: 'different-hash',
      extraction: { ok: false, error: 'Extractor timed out' },
    })
  );
  assert.equal(failed.advanceProcessedBaseline, false);
  assert.equal(failed.summary, 'Scan failed');
  assert.notEqual(failed.summary, 'No changes found');

  const changed = decideExtractionSkip({
    forceFull: false,
    now: NOW,
    lastFullScanAt: recent,
    fullVerificationIntervalMs: EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
    processedContentHash: 'same-hash',
    httpStatus: 200,
    conditionalValidatorsSent: false,
    contentHash: 'different-hash',
    requiresBrowser: false,
    browserContentHash: null,
    monitorDetailPages: false,
    detailHashesMatch: true,
  });
  assert.equal(changed.skip, false);

  const shell = '<html><body><div class="cookie">Accept cookies</div><main><h1>Industry Summit</h1><p>Nov 2</p></main></body></html>';
  const noisy = shell.replace('Accept cookies', 'Accept cookies ' + Math.random());
  assert.equal(hashContent(extractRelevantContent(shell)), hashContent(extractRelevantContent(noisy)));
  const edited = shell.replace('Industry Summit', 'Industry Summit Updated');
  assert.notEqual(hashContent(extractRelevantContent(shell)), hashContent(extractRelevantContent(edited)));

  const browser304 = decideExtractionSkip({
    forceFull: false,
    now: NOW,
    lastFullScanAt: recent,
    fullVerificationIntervalMs: EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
    processedContentHash: 'rendered',
    httpStatus: 304,
    conditionalValidatorsSent: true,
    contentHash: null,
    requiresBrowser: true,
    browserContentHash: null,
    monitorDetailPages: false,
    detailHashesMatch: true,
  });
  assert.equal(browser304.skip, false);

  const detailChanged = decideExtractionSkip({
    forceFull: false,
    now: NOW,
    lastFullScanAt: recent,
    fullVerificationIntervalMs: EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
    processedContentHash: 'listing',
    httpStatus: 200,
    conditionalValidatorsSent: false,
    contentHash: 'listing',
    requiresBrowser: false,
    browserContentHash: null,
    monitorDetailPages: true,
    detailHashesMatch: false,
  });
  assert.equal(detailChanged.skip, false);
}

function testMatchingAndDiff() {
  const messy = extracted({
    title: 'Industry   Summit',
    url: 'https://events.example.com/summit?utm_source=newsletter',
    description: 'A gathering of media teams.',
  });
  const clean = extracted();
  const formatting = buildCheckRecords(
    check({
      source: source({
        processedContentHash: 'old',
        lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      }),
      contentHash: 'new',
      extraction: { ok: true, events: [clean], method: 'fixture' },
      calendarEvents: [calendarFrom(messy)],
      identities: [
        {
          stableKey: 'url:https://events.example.com/summit',
          identityKind: 'EVENT_URL',
          eventId: 'event-1',
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { 'url:https://events.example.com/summit': messy },
    })
  );
  assert.equal(formatting.proposals.length, 0);
  assert.equal(formatting.summary, 'No changes found');

  const original = extracted();
  const moved = extracted({ start: '2026-11-09', end: '2026-11-09', location: 'Boston, MA' });
  const dateChange = buildCheckRecords(
    check({
      source: source({
        processedContentHash: 'old',
        lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      }),
      contentHash: 'changed',
      extraction: { ok: true, events: [moved], method: 'fixture' },
      calendarEvents: [calendarFrom(original)],
      identities: [
        {
          stableKey: 'url:https://events.example.com/summit',
          identityKind: 'EVENT_URL',
          eventId: 'event-1',
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { 'url:https://events.example.com/summit': original },
    })
  );
  assert.equal(dateChange.newEvents, 0);
  assert.equal(dateChange.pendingEvents.length, 0);
  assert.equal(dateChange.changedEvents, 1);
  assert.equal(dateChange.proposals[0].kind, 'SOURCE_CHANGE');
  assert.ok(dateChange.proposals[0].changedFields.includes('location'));
  assert.equal(dateChange.proposals[0].stableKey, 'url:https://events.example.com/summit');

  const shared = buildCheckRecords(
    check({
      extraction: {
        ok: true,
        method: 'fixture',
        events: [
          extracted({ title: 'Morning Briefing', url: LISTING }),
          extracted({ title: 'Evening Briefing', url: LISTING }),
        ],
      },
      calendarEvents: [calendarFrom(extracted({ title: 'Some Other Event', url: LISTING }), 'other')],
    })
  );
  assert.equal(shared.pendingEvents.length, 2);
  assert.notEqual(shared.identityLinks[0].stableKey, shared.identityLinks[1].stableKey);

  const editions = assignIdentities(
    [
      extracted({ title: 'Industry Summit 2025', url: LISTING, start: '2025-11-02', end: '2025-11-02' }),
      extracted({ title: 'Industry Summit 2026', url: LISTING }),
    ],
    LISTING
  );
  assert.notEqual(editions[0].stableKey, editions[1].stableKey);
  assert.equal(editions[0].ambiguous, false);

  const sessions = buildCheckRecords(
    check({
      extraction: {
        ok: true,
        method: 'fixture',
        events: [
          extracted({ title: 'Office Hours', url: LISTING, start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T16:00:00.000Z', temporalKind: 'TIMED', timezone: 'America/New_York' }),
          extracted({ title: 'Office Hours', url: LISTING, start: '2026-11-02T20:00:00.000Z', end: '2026-11-02T21:00:00.000Z', temporalKind: 'TIMED', timezone: 'America/New_York' }),
        ],
      },
    })
  );
  assert.equal(sessions.candidates.length, 2);
  assert.equal(sessions.pendingEvents.length, 0);
  assert.ok(sessions.candidates.every((candidate) => candidate.matchStatus === 'AMBIGUOUS'));
  assert.notEqual(sessions.candidates[0].stableKey, sessions.candidates[1].stableKey);

  const again = buildCheckRecords(
    check({
      source: source({
        processedContentHash: 'old',
        lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      }),
      contentHash: 'changed',
      extraction: { ok: true, events: [moved], method: 'fixture' },
      calendarEvents: [calendarFrom(original)],
      identities: [
        {
          stableKey: dateChange.proposals[0].stableKey,
          identityKind: 'EVENT_URL',
          eventId: 'event-1',
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { [dateChange.proposals[0].stableKey]: original },
      proposals: [
        {
          eventId: 'event-1',
          signature: dateChange.proposals[0].signature,
          reviewStatus: 'PENDING',
        },
      ],
    })
  );
  assert.equal(again.proposals.length, 0);

  const previousObservation = dateChange.observations[0].payload;
  const previousCopy = structuredClone(previousObservation);
  const later = buildCheckRecords(
    check({
      source: source({
        processedContentHash: 'old',
        lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      }),
      contentHash: 'later',
      extraction: { ok: true, events: [extracted({ description: 'Updated description.' })], method: 'fixture' },
      calendarEvents: [calendarFrom(original)],
      identities: [
        {
          stableKey: 'url:https://events.example.com/summit',
          identityKind: 'EVENT_URL',
          eventId: 'event-1',
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { 'url:https://events.example.com/summit': previousObservation },
    })
  );
  assert.deepEqual(previousObservation, previousCopy);
  assert.notEqual(later.observations[0], dateChange.observations[0]);
  assert.equal(later.proposals.length, 1);
}

function testReviewAndScheduling() {
  const event = calendarFrom(extracted());
  const approved = decideProposalReview({
    action: 'approve',
    proposal: {
      reviewStatus: 'PENDING',
      proposedValues: { location: 'Boston, MA' },
      changedFields: ['location'],
      eventUpdatedAtSnapshot: event.updatedAt,
    },
    event,
  });
  assert.equal(approved.type, 'apply');
  if (approved.type !== 'apply') return;
  assert.equal(approved.data.location, 'Boston, MA');
  assert.equal(approved.data.sponsoredBy, undefined);
  assert.equal(approved.data.title, undefined);
  assert.equal(approved.data.start, undefined);

  const conflict = decideProposalReview({
    action: 'approve',
    proposal: {
      reviewStatus: 'PENDING',
      proposedValues: { location: 'Boston, MA' },
      changedFields: ['location'],
      eventUpdatedAtSnapshot: event.updatedAt,
    },
    event: { ...event, updatedAt: new Date(event.updatedAt.getTime() + 60_000) },
  });
  assert.equal(conflict.type, 'conflict');

  const rejected = decideProposalReview({
    action: 'reject',
    proposal: {
      reviewStatus: 'PENDING',
      proposedValues: { location: 'Boston, MA' },
      changedFields: ['location'],
      eventUpdatedAtSnapshot: event.updatedAt,
    },
    event,
  });
  assert.equal(rejected.type, 'rejected');

  const original = extracted();
  const moved = extracted({ location: 'Boston, MA' });
  const first = buildCheckRecords(
    check({
      source: source({ processedContentHash: 'old', lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
      contentHash: 'changed',
      extraction: { ok: true, events: [moved], method: 'fixture' },
      calendarEvents: [event],
      identities: [
        {
          stableKey: 'url:https://events.example.com/summit',
          identityKind: 'EVENT_URL',
          eventId: event.id,
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { 'url:https://events.example.com/summit': original },
    })
  );
  const repeat = buildCheckRecords(
    check({
      source: source({ processedContentHash: 'old', lastFullScanAt: new Date(NOW.getTime() - 60 * 60 * 1000) }),
      contentHash: 'changed',
      extraction: { ok: true, events: [moved], method: 'fixture' },
      calendarEvents: [event],
      identities: [
        {
          stableKey: 'url:https://events.example.com/summit',
          identityKind: 'EVENT_URL',
          eventId: event.id,
          pendingEventId: null,
          baselineEstablishedAt: new Date('2026-10-01T00:00:00.000Z'),
          ambiguous: false,
        },
      ],
      latestPayloadByKey: { 'url:https://events.example.com/summit': original },
      proposals: [{ eventId: event.id, signature: first.proposals[0].signature, reviewStatus: 'REJECTED' }],
    })
  );
  assert.equal(repeat.proposals.length, 0);

  for (const result of [
    buildCheckRecords(check({ httpStatus: 403, extraction: null })),
    buildCheckRecords(check({ httpStatus: 500, extraction: null })),
    buildCheckRecords(check({ partial: true, extraction: null })),
    buildCheckRecords(check({ extraction: { ok: true, events: [], method: 'fixture' } })),
  ]) {
    assert.notEqual(result.summary, 'No changes found');
  }

  assert.equal(isDueForScheduledCheck(source({ enabled: false }), NOW), false);
  assert.equal(
    isDueForScheduledCheck(source({ monitoringEndsAt: new Date('2026-10-01T00:00:00.000Z') }), NOW),
    false
  );
  assert.equal(isDueForScheduledCheck(source({ nextCheckAt: new Date('2026-10-08T00:00:00.000Z') }), NOW), false);
  assert.equal(isDueForScheduledCheck(source(), NOW), true);

  const claimed = claimSource(source(), NOW, 'worker-a');
  assert.equal(claimed.claimed, true);
  const racing = claimSource(claimed.source, new Date(NOW.getTime() + 1000), 'worker-b');
  assert.equal(racing.claimed, false);
  const recovered = claimSource(
    claimed.source,
    new Date(NOW.getTime() + EVENT_WATCH_CLAIM_STALE_MS + 1),
    'worker-c'
  );
  assert.equal(recovered.claimed, true);
  assert.equal(
    isAbandonedScan({ status: 'RUNNING', startedAt: new Date(NOW.getTime() - EVENT_WATCH_CLAIM_STALE_MS - 1) }, NOW),
    true
  );
  assert.equal(isAbandonedScan({ status: 'SUCCESS', startedAt: new Date(0) }, NOW), false);

  assert.throws(() => resolveDatabaseUrl({ VERCEL_ENV: 'preview', DATABASE_URL: 'postgres://production/db' }));
  assert.throws(() =>
    resolveDatabaseUrl({
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgres://production/db',
      STORAGE_DATABASE_URL: 'postgres://production/db',
    })
  );
  assert.equal(
    resolveDatabaseUrl({
      VERCEL_ENV: 'staging',
      DATABASE_URL: 'postgres://production/db',
      STORAGE_DATABASE_URL: 'postgres://staging/db',
    }),
    'postgres://staging/db'
  );
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: 'production' }));

  const prismaConfig = readFileSync(new URL('../prisma.config.ts', import.meta.url), 'utf8');
  assert.match(prismaConfig, /resolveDatabaseUrl/);
  const migration = readFileSync(
    new URL('../prisma/migrations/20261007180000_event_watch_durable_history/migration.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /LEGACY/);
  assert.doesNotMatch(migration, /No changes found/);
}

function run() {
  testBaselineAndNewEvent();
  testSkipAndFailure();
  testMatchingAndDiff();
  testReviewAndScheduling();
  console.log('All Event Watch tests passed.');
}

run();
