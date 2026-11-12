import assert from 'node:assert/strict';
import { formatCheckTimestamp, schedulerHealth } from '../src/lib/eventWatchDisplay';

const summer = formatCheckTimestamp('2027-09-27T16:00:00Z', 'en-US', 'America/New_York');
assert.match(summer, /Sep 27, 2027/);
assert.match(summer, /12:00 PM EDT/);
assert.match(formatCheckTimestamp('2027-01-15T17:00:00Z', 'en-US', 'America/New_York'), /12:00 PM EST/);
assert.equal(formatCheckTimestamp(null), 'Never');
assert.equal(formatCheckTimestamp('invalid'), 'Unknown');
const now = Date.parse('2026-11-10T16:00:00Z');
assert.match(schedulerHealth({ startedAt: '2026-11-10T15:00:00Z', finishedAt: '2026-11-10T15:10:00Z', outcome: 'FAILED' }, now), /failed/);
assert.match(schedulerHealth({ startedAt: '2026-11-10T15:00:00Z', finishedAt: null, outcome: 'RUNNING' }, now), /running/);
assert.match(schedulerHealth({ startedAt: '2026-11-09T15:00:00Z', finishedAt: null, outcome: 'RUNNING' }, now), /not run recently/);
console.log('Event Watch display regressions passed.');
