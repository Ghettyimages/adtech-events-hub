import assert from 'node:assert/strict';
import { extractStrictDates, preferPageClockTimes } from '../src/lib/extractor/dateExtractor';
import { normalizeEventForWrite, TEMPORAL_KIND, toFullCalendarEvent, toGoogleCalendarPayload, toICalEvent } from '../src/lib/eventTemporal';

const page = (text: string) => `<html><body><h1>Industry Conference</h1><p>${text}</p></body></html>`;
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
check('Yearless dates do not use current year', () => {
  assert.equal(extractStrictDates(page('September 27–30')).date_status, 'tbd');
});
check('Copyright year is not event year', () => {
  assert.equal(extractStrictDates(page('September 27–30') + '<footer>Copyright 2027</footer>').date_status, 'tbd');
});
check('Registration and publishing dates are not event dates', () => {
  assert.equal(extractStrictDates(page('Registration deadline: September 27, 2027')).date_status, 'tbd');
  assert.equal(extractStrictDates(page('Published on September 27, 2027')).date_status, 'tbd');
});
check('Mixed-edition page does not silently select first date', () => {
  assert.equal(extractStrictDates(page('September 27–28, 2027; Previous agenda September 28–29, 2026')).date_status, 'tbd');
});
check('Advertising Week September 27 to September 30 2027 is four all-day dates', () => {
  const dates = extractStrictDates(page('Advertising Week New York 2027 will take place from September 27 to September 30, 2027.'));
  assert.equal(dates.start, '2027-09-27'); assert.equal(dates.end, '2027-09-30');
  const temporal = normalizeEventForWrite({ temporalKind: TEMPORAL_KIND.ALL_DAY, start: dates.start!, end: dates.end! });
  assert.deepEqual(toGoogleCalendarPayload(temporal), { start: { date: '2027-09-27' }, end: { date: '2027-10-01' } });
  const calendar = toFullCalendarEvent({ ...temporal, id: 'fixture', title: 'AW' } as any);
  assert.equal(calendar.start, '2027-09-27'); assert.equal(calendar.end, '2027-10-01');
  const ical = toICalEvent(temporal);
  assert.equal((ical.start as Date).toISOString(), '2027-09-27T00:00:00.000Z');
  assert.equal((ical.end as Date).toISOString(), '2027-10-01T00:00:00.000Z');
});
check('Invalid February day is not rolled into March', () => {
  assert.equal(extractStrictDates(page('February 30, 2027')).date_status, 'tbd');
  assert.throws(() => normalizeEventForWrite({ temporalKind: 'ALL_DAY', start: '2027-02-30', end: '2027-03-02' }), /Invalid civil date/);
});
check('Leap day validates the actual year', () => {
  assert.equal(extractStrictDates(page('February 29, 2028')).start, '2028-02-29');
  assert.equal(extractStrictDates(page('February 29, 2027')).date_status, 'tbd');
});
check('Reverse all-day range is rejected', () => {
  assert.equal(extractStrictDates(page('September 30–27, 2027')).date_status, 'tbd');
});
check('December rollover with start year is source-backed', () => {
  const d = extractStrictDates(page('December 28, 2026 - January 3'));
  assert.equal(d.start, '2026-12-28'); assert.equal(d.end, '2027-01-03');
});
check('December rollover with end year uses prior start year', () => {
  const d = extractStrictDates(page('December 28 - January 3, 2027'));
  assert.equal(d.start, '2026-12-28'); assert.equal(d.end, '2027-01-03');
});
const json = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
check('Explicit midnight offset stays timed and keeps civil date', () => {
  const d = extractStrictDates(json({ '@type': 'Event', name: 'Midnight', startDate: '2027-01-03T00:00:00+14:00', endDate: '2027-01-03T01:00:00+14:00' }));
  assert.equal(d.start, '2027-01-03T00:00:00+14:00'); assert.equal(d.end, '2027-01-03T01:00:00+14:00');
});
check('Structured graph events are supported', () => {
  assert.equal(extractStrictDates(json({ '@graph': [{ '@type': 'Event', startDate: '2027-09-27', endDate: '2027-09-30' }] })).end, '2027-09-30');
});
check('Different structured events need scoped selection', () => {
  assert.equal(extractStrictDates(json([{ '@type': 'Event', startDate: '2027-09-27' }, { '@type': 'Event', startDate: '2027-10-01' }])).date_status, 'tbd');
});
check('A timed start without an end cannot fabricate a confirmed range', () => {
  assert.equal(extractStrictDates(json({ '@type': 'Event', startDate: '2027-01-03T18:00:00-05:00' })).date_status, 'tbd');
});
check('Spring-forward nonexistent local clock is rejected', () => {
  assert.throws(() => normalizeEventForWrite({ temporalKind: 'TIMED', start: '2027-03-14T02:30', end: '2027-03-14T04:00', timezone: 'America/New_York' }), /Nonexistent/);
});
check('Fall-back ambiguous local clock requires offset', () => {
  assert.throws(() => normalizeEventForWrite({ temporalKind: 'TIMED', start: '2027-11-07T01:30', end: '2027-11-07T03:00', timezone: 'America/New_York' }), /Ambiguous/);
  assert.equal(normalizeEventForWrite({ temporalKind: 'TIMED', start: '2027-11-07T01:30:00-04:00', end: '2027-11-07T03:00:00-05:00', timezone: 'America/New_York' }).start.toISOString(), '2027-11-07T05:30:00.000Z');
});
check('Multi-day source with a single clock range remains all-day', () => {
  assert.equal(preferPageClockTimes('2027-09-27', '2027-09-30', page('September 27, 2027 9AM - 5PM')), null);
});
console.log(`All ${checks} strict date evidence checks passed.`);
