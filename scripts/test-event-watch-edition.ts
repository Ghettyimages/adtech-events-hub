import assert from 'node:assert/strict';
import { assignIdentities, extractDetailLinks, matchCalendarEvent, type CalendarEventSnapshot } from '../src/lib/eventWatchLogic';
import { editionsCompatible } from '../src/lib/eventWatchEdition';
import type { ExtractedEvent } from '../src/lib/extractor/schema';

const event = (start: string, title = 'Media Summit'): ExtractedEvent => ({ title, start, end: start,
  date_status: 'confirmed', location_status: 'tbd', url: 'https://example.com/summit' });
const calendar = { id: 'prior', title: 'Media Summit', start: new Date('2026-09-01'), timezone: null,
  url: 'https://example.com/summit' } as CalendarEventSnapshot;
assert.equal(editionsCompatible(calendar, event('2026-10-01')), true);
assert.equal(editionsCompatible(calendar, event('2027-09-01')), false);
assert.equal(editionsCompatible({ ...calendar, title: 'Media Summit 2026' }, event('2026-10-01', 'Media Summit 2027')), false);
const [nextYear] = assignIdentities([event('2027-09-01')], 'https://example.com/events');
assert.equal(matchCalendarEvent(nextYear, [calendar]).type, 'ambiguous');
const [rescheduled] = assignIdentities([event('2026-10-01')], 'https://example.com/events');
assert.equal(matchCalendarEvent(rescheduled, [calendar]).type, 'unique');
const [persistedNextYear] = assignIdentities([event('2027-09-01')], 'https://example.com/events',
  [{ stableKey: nextYear.stableKey, lastStart: '2026-09-01' }]);
assert.equal(persistedNextYear.ambiguous, true);
const [conservative2026] = assignIdentities([{ ...event('2026-09-01'), url: undefined }], 'https://example.com/events');
const [conservative2027] = assignIdentities([{ ...event('2027-09-01'), url: undefined }], 'https://example.com/events');
assert.notEqual(conservative2026.stableKey, conservative2027.stableKey);
assert.equal(matchCalendarEvent(nextYear, [calendar], { stableKey: nextYear.stableKey, identityKind: 'EVENT_URL',
  eventId: calendar.id, pendingEventId: null, baselineEstablishedAt: new Date(), ambiguous: false }).type, 'ambiguous');
assert.deepEqual(extractDetailLinks(`<nav><a href="/events/navigation">Events</a></nav><main>
  <a href="/privacy">Privacy</a><a href="https://linkedin.com/events/unrelated">Social</a>
  <a href="/about">About</a><article class="event-card"><a href="/annual-2027">Media leaders</a></article>
  <a href="/events/second">Second conference</a></main><footer><a href="/events/footer">Footer</a></footer>`,
  'https://example.com/events', 1), ['https://example.com/annual-2027']);
console.log('Event Watch edition regressions passed.');
