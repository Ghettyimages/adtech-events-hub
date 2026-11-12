import assert from 'node:assert/strict';
import { assessEventEvidence, verifyExtractedEvents } from '../src/lib/eventEvidence';
import type { ExtractedEvent } from '../src/lib/extractor/schema';

const event = (changes: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  title: 'Media Summit', start: '2027-09-27', end: '2027-09-30',
  date_status: 'confirmed', evidence: 'September 27 to September 30, 2027',
  evidence_context: 'visible-text', location_status: 'tbd', ...changes,
});
const source = '<article><h2>Media Summit</h2><p>September 27 to September 30, 2027</p></article>';
assert.equal(assessEventEvidence(event(), source).verified, true, 'Full source-backed range is accepted');
assert.equal(assessEventEvidence(event({ end: '2027-09-27' }), source).verified, false, 'A model cannot shorten the source range');
assert.equal(assessEventEvidence(event({ title: 'Invented Summit' }), source).verified, false, 'Unseen model title rejected');
assert.equal(assessEventEvidence(event({ date_status: 'tbd' }), source).verified, false, 'Unconfirmed model date rejected');
assert.equal(assessEventEvidence(event({ evidence: undefined }), source).verified, false, 'Missing source evidence rejected');
assert.equal(assessEventEvidence(event({ evidence: 'September 1, 2027' }), source).verified, false, 'Fabricated quote rejected');
assert.equal(assessEventEvidence(event(), '<article><h2>Media Summit</h2><p>Date TBA</p></article>' +
  '<article><h2>Other Summit</h2><p>September 27 to September 30, 2027</p></article>').verified, false,
  'An adjacent event cannot supply dates');
assert.equal(assessEventEvidence(event(), '<h1>Media Summit</h1><p>Date TBA</p><h2>Other Summit</h2><p>September 27 to September 30, 2027</p>').verified,
  false, 'Heading boundaries prevent borrowing dates');
assert.equal(assessEventEvidence(event({ start: '2026-09-27', end: '2026-09-30' }),
  '<article><h2>Media Summit</h2><p>September 27 to September 30</p></article><footer>Copyright 2026</footer>').verified,
  false, 'Footer year cannot confirm event year');
const unsupportedLocation = assessEventEvidence(event({ location: 'Atlanta, GA', city: 'Atlanta', region: 'GA', country: 'US',
  location_status: 'confirmed', location_evidence: 'Atlanta, GA' }), source);
assert.equal(unsupportedLocation.verified, true);
assert.equal(unsupportedLocation.event.location, undefined);
assert.equal(unsupportedLocation.event.city, undefined, 'Unsupported structured geography removed');
const supportedLocation = assessEventEvidence(event({ location: 'Atlanta, GA', location_status: 'confirmed', location_evidence: 'Atlanta, GA' }),
  source.replace('</article>', '<p>Atlanta, GA</p></article>'));
assert.equal(supportedLocation.event.location, 'Atlanta, GA');
const structured = '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event',
  name: 'Media Summit', startDate: '2027-09-27', endDate: '2027-09-30' }) + '</script>';
assert.equal(assessEventEvidence(event({ evidence: '2027-09-27 to 2027-09-30', evidence_context: 'json-ld' }), structured).verified,
  true, 'Named structured event can establish associated dates');
assert.equal(assessEventEvidence(event({ title: 'Other Summit' }), structured).verified, false, 'Other structured event cannot confirm dates');
const mixed = verifyExtractedEvents([event(), event({ title: 'Made up' })], source);
assert.equal(mixed.events.length, 1);
assert.equal(mixed.rejected.length, 1, 'Partial extraction retains rejection count');
const wrongLocation = assessEventEvidence(event({ location: 'Miami, FL', city: 'Miami',
  location_status: 'confirmed', location_evidence: 'New York, NY' }), source.replace('</article>', '<p>New York, NY</p></article>'));
assert.equal(wrongLocation.event.location, undefined, 'A literal quote cannot validate a different location');
const wrongGeography = assessEventEvidence(event({ location: 'Atlanta, GA', city: 'Miami', region: 'FL', country: 'Canada',
  location_status: 'confirmed', location_evidence: 'Atlanta, GA' }), source.replace('</article>', '<p>Atlanta, GA</p></article>'));
assert.equal(wrongGeography.event.city, 'Atlanta', 'Geography is derived from verified place, not model fields');
assert.notEqual(wrongGeography.event.country, 'Canada');
assert.equal(assessEventEvidence(event({ description: 'Celebrity speakers and free tickets' }), source).event.description,
  undefined, 'Invented description omitted');
assert.equal(assessEventEvidence(event({ description: 'September 27 to September 30, 2027' }), source).event.description,
  'September 27 to September 30, 2027', 'Literal source description retained');
assert.equal(assessEventEvidence(event({ url: 'https://invented.example/tickets' }), source).event.url,
  undefined, 'Invented registration URL omitted');
assert.equal(assessEventEvidence(event({ url: 'https://source.example/summit' }), source.replace('</article>', '<a href="/summit">Details</a></article>'),
  'https://source.example/events').event.url, 'https://source.example/summit', 'Relative source links verified');
assert.equal(assessEventEvidence(event({ url: 'javascript:alert(1)' }), source + '<a href="javascript:alert(1)">Details</a>').event.url,
  undefined, 'Non HTTP URL rejected');
assert.equal(assessEventEvidence(event(), '<script>const fake="Media Summit September 27 to September 30, 2027";</script>').verified,
  false, 'Executable script data cannot supply visible evidence');
console.log('Event evidence tests passed.');
