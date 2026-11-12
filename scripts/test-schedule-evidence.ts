import assert from 'node:assert/strict';
import { groundScheduleDates } from '../src/lib/scheduleEvidence';

const title = 'Advertising Week New York 2027';
const model = { title, start: '2027-09-27T08:00:00', end: '2027-09-30T18:00:00' };
const source = `${title} will take place from September 27 to September 30, 2027.\nNew Location: Javits Center and Hudson Yards in New York City.`;
const result = groundScheduleDates(model, source, [title], 'America/New_York');
assert.ok(result);
assert.equal(result.temporalKind, 'ALL_DAY');
assert.equal(result.start, '2027-09-27');
assert.equal(result.end, '2027-09-30');
assert.equal(result.timezone, undefined);

assert.equal(groundScheduleDates({ ...model, title: 'Unannounced Event' }, source, ['Unannounced Event'], 'America/New_York'), null);
assert.equal(groundScheduleDates({ title: 'Media Summit', start: '2027-09-27', end: '2027-09-27' }, 'Media Summit\nSeptember 27\nCopyright 2027', ['Media Summit'], 'America/New_York'), null);
assert.equal(groundScheduleDates({ title: 'Media Summit', start: '2027-02-28', end: '2027-02-28' }, 'Media Summit\nFebruary 30, 2027', ['Media Summit'], 'America/New_York'), null);
assert.equal(groundScheduleDates(model, source, [title], 'America/New_York', { start: '2027-06-20', end: '2027-06-25' }), null);

const session = groundScheduleDates({ title: 'Opening Discussion', start: '2026-06-22T08:00:00', end: '2026-06-22T18:00:00' }, 'Monday, June 22, 2026\nOpening Discussion\n2:00 PM - 2:45 PM\nNext Session\n4:00 PM - 5:00 PM', ['Opening Discussion', 'Next Session'], 'Europe/Paris');
assert.ok(session);
assert.equal(session.temporalKind, 'TIMED');
assert.equal(session.start, '2026-06-22T14:00:00');
assert.equal(session.end, '2026-06-22T14:45:00');
assert.equal(session.timezone, 'Europe/Paris');
const precedingClock = groundScheduleDates({ title: 'Opening Discussion', start: '2026-06-22T08:00:00', end: '2026-06-22T18:00:00' }, 'Monday, June 22, 2026\n2:00 PM - 2:45 PM (CEST)\nOpening Discussion\nVenue', ['Opening Discussion'], 'Europe/Paris');
assert.equal(precedingClock?.start, '2026-06-22T14:00:00');
assert.equal(groundScheduleDates({ title: 'Evening Reception', start: '2026-06-22T18:00:00', end: '2026-06-22T20:00:00' }, 'Evening Reception\nJune 22, 2026, starts at 6 pm', ['Evening Reception'], 'Europe/Paris'), null);
assert.equal(groundScheduleDates({ title: 'Undated Session', start: '2026-06-22', end: '2026-06-22' }, 'Other Event June 22, 2026\nUndated Session\nLocation TBD', ['Undated Session'], 'Europe/Paris'), null);
assert.equal(groundScheduleDates({ title: 'Media', start: '2026-06-22', end: '2026-06-22' }, 'MultimediaPlus June 22, 2026', ['Media'], 'Europe/Paris'), null);
assert.equal(groundScheduleDates({ title: 'Undated Session', start: '2026-06-22', end: '2026-06-22' }, 'Monday, June 22, 2026\nUndated Session\nDate TBD', ['Undated Session'], 'Europe/Paris'), null);
console.log('Schedule source-date evidence tests passed.');
