import assert from 'node:assert/strict';
import { scrapeVerification } from '../src/lib/scrapeVerification';

assert.equal(scrapeVerification([], []).verificationStatus, 'UNVERIFIED');
const rejected = { title: 'Ghost Summit', reasons: ['Source date is missing'] };
const partial = scrapeVerification([{ title: 'Real Summit' }], [rejected, rejected]);
assert.equal(partial.verificationStatus, 'PARTIAL');
assert.equal(partial.rejectedEvents, 1);
assert.equal(partial.verificationIssues.length, 1);
const recovered = scrapeVerification([{ title: 'Ghost Summit' }], [rejected]);
assert.equal(recovered.verificationStatus, 'PARTIAL');
assert.equal(recovered.rejectedEvents, 1);
assert.equal(scrapeVerification([], [rejected]).verificationStatus, 'UNVERIFIED');
console.log('Direct scrape verification regressions passed.');
