/** Source-grounding boundary for automated extraction. Model output is a hypothesis. */
import * as cheerio from 'cheerio';
import type { ExtractedEvent } from './extractor/schema';
import { extractStrictDates } from './extractor/dateExtractor';
import { parseLocationString } from './extractor/locationExtractor';
import { DateTime } from 'luxon';

export type EvidenceAssessment = { verified: boolean; reasons: string[]; warnings: string[]; event: ExtractedEvent };

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function civil(value: string | undefined): string | undefined {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}
function pageText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, nav, footer').remove();
  $('p, div, li, tr, time, span, br, h1, h2, h3, h4, h5, h6').each((_, element) => { $(element).prepend(' ').append(' '); });
  return $('body').text().replace(/\s+/g, ' ').trim();
}
function scopedHtml(html: string, title: string): string | null {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, nav, footer').remove();
  const target = normalized(title);
  const scopes: Array<{ html: string; length: number }> = [];
  $('article, li, tr, [itemtype*="Event"], [data-event-id], [class*="event-card"], [class*="event-item"], [class*="event-listing"], [class~="card"]').each((_, element) => {
    const text = normalized($(element).text());
    if (text.includes(target)) scopes.push({ html: $.html(element), length: text.length });
  });
  // The smallest event container wins, even if another card has the desired date.
  if (scopes.length) return scopes.sort((a, b) => a.length - b.length)[0].html;

  // Event-specific microdata may live beside a heading in attributes, not text.
  let microdataScope: string | null = null;
  $('h1,h2,h3,h4,h5,h6').each((_, heading) => {
    if (normalized($(heading).text()) !== target || microdataScope) return;
    $(heading).parents().each((_, parent) => {
      if (microdataScope || ['body', 'html'].includes(parent.tagName)) return;
      const node = $(parent);
      if (!node.find('meta[itemprop="startDate"],time[itemprop="startDate"]').length) return;
      const headings = node.find('h1,h2,h3,h4,h5,h6').toArray();
      if (headings.every((item) => normalized($(item).text()) === target)) microdataScope = $.html(parent);
    });
  });
  if (microdataScope) return microdataScope;

  // A heading and its following section are a bounded fallback on detail pages.
  const marker = '\u241e';
  $('h1,h2,h3,h4,h5,h6').each((_, element) => {
    $(element).prepend(marker);
  });
  $('p, div, li, tr, time, span, br').each((_, element) => { $(element).prepend(' ').append(' '); });
  const sections = $('body').text().split(marker);
  const section = sections.find((text) => normalized(text).startsWith(target));
  if (section) return `<p>${escapeHtml(section)}</p>`;
  const text = $('body').text();
  // A short standalone text submission can be verified without heading markup.
  return text.length <= 3000 && normalized(text).includes(target)
    ? `<p>${escapeHtml(text)}</p>` : null;
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function structuredEventScopes(html: string, title: string): string[] {
  const $ = cheerio.load(html);
  const scopes: string[] = [];
  function walk(value: unknown) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
    if (types.some((type) => typeof type === 'string' && /(?:^|\/)Event$/.test(type)) &&
        typeof record.name === 'string' && normalized(record.name) === normalized(title)) {
      scopes.push(`<script type="application/ld+json">${JSON.stringify(record).replace(/</g, '\\u003c')}</script>`);
    }
    Object.values(record).forEach(walk);
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { walk(JSON.parse($(element).text())); } catch { /* malformed JSON is not evidence */ }
  });
  return scopes;
}
function sameSourceRange(event: ExtractedEvent, scope: string): boolean {
  const strict = extractStrictDates(scope);
  if (strict.date_status !== 'confirmed' || !strict.start ||
      civil(event.start) !== civil(strict.start) ||
      civil(event.end || event.start) !== civil(strict.end || strict.start)) return false;
  const sourceTimed = Boolean(strict.start.includes('T') && strict.end?.includes('T'));
  const eventTimed = Boolean(event.start?.includes('T') && event.end?.includes('T'));
  if (sourceTimed !== eventTimed) return false;
  if (!sourceTimed) return true;
  const sameClock = (a: string, b: string) => {
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/;
    if (zoned.test(a) !== zoned.test(b)) return false;
    if (zoned.test(a) && zoned.test(b)) return new Date(a).getTime() === new Date(b).getTime();
    return a.slice(0, 19).padEnd(19, ':00') === b.slice(0, 19).padEnd(19, ':00');
  };
  return sameClock(event.start!, strict.start) && sameClock(event.end!, strict.end!);
}

export function assessEventEvidence(event: ExtractedEvent, html: string, sourceUrl?: string): EvidenceAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (!event.title?.trim() || normalized(event.title).length < 3) reasons.push('Event title is missing or too short to verify');
  if (event.date_status !== 'confirmed') reasons.push('Event dates are not confirmed by the source');
  if (!event.start || !event.end) reasons.push('Event date range is incomplete');
  const structured = structuredEventScopes(html, event.title || '');
  const scope = scopedHtml(html, event.title || '');
  if (!scope && structured.length === 0) reasons.push('Event title has no identifiable source context');
  const structuredMatch = structured.some((candidate) => sameSourceRange(event, candidate));
  if (structuredMatch && scope) {
    const visibleDates = extractStrictDates(scope);
    if (visibleDates.date_status === 'confirmed' && !sameSourceRange(event, scope)) {
      reasons.push('Visible event dates conflict with the structured event dates');
    }
  }
  const metaMatch = Boolean(scope && cheerio.load(scope)('meta[itemprop="startDate"],time[itemprop="startDate"]').length && sameSourceRange(event, scope));
  if (!structuredMatch && !metaMatch) {
    const evidence = event.evidence?.replace(/\s*\(multi-day event\)\s*$/i, '').trim();
    if (!evidence || !scope || !normalized(pageText(scope)).includes(normalized(evidence))) {
      reasons.push('Date evidence is missing from this event’s source context');
    }
    if (!scope || !sameSourceRange(event, scope)) reasons.push('Extracted dates do not match this event’s source date range');
  }

  let verifiedEvent = { ...event, evidenceUrl: sourceUrl };
  const hasClock = Boolean(event.start?.includes('T') || event.end?.includes('T'));
  if (hasClock) {
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/;
    if (event.start && event.end && zoned.test(event.start) && zoned.test(event.end)) {
      // Keep the source instant; do not attach the New York fallback to global offsets.
      const start = DateTime.fromISO(event.start, { setZone: true });
      const end = DateTime.fromISO(event.end, { setZone: true });
      if (!start.isValid || !end.isValid || end <= start) {
        reasons.push('Source clock range is invalid');
      } else {
        verifiedEvent.start = start.toUTC().toISO()!;
        verifiedEvent.end = end.toUTC().toISO()!;
        verifiedEvent.timezone = 'UTC';
        verifiedEvent.temporalKind = 'TIMED';
      }
    } else {
      const sourceText = scope ? pageText(scope) : '';
      const zone = sourceTimezone(sourceText, event.start, event.end);
      if (!zone) reasons.push('Clock times lack an explicit, unambiguous source timezone');
      else verifiedEvent.timezone = zone;
    }
  } else {
    verifiedEvent.timezone = undefined;
  }
  // Optional fields are omitted, rather than presented as facts, when unsupported.
  const text = scope ? normalized(pageText(scope)) : '';
  if (event.location) {
    const locationEvidence = event.location_evidence?.trim();
    if (event.location_status !== 'confirmed' || !locationEvidence ||
        !text.includes(normalized(locationEvidence)) || !text.includes(normalized(event.location))) {
      verifiedEvent = { ...verifiedEvent, location: undefined, city: undefined, region: undefined,
        country: undefined, location_status: 'tbd', location_evidence: undefined, location_evidence_context: undefined };
      warnings.push('Unsupported location and structured geography were omitted');
    } else {
      const parsed = parseLocationString(event.location);
      verifiedEvent = { ...verifiedEvent, city: parsed.city, region: parsed.region, country: parsed.country };
    }
  } else {
    verifiedEvent = { ...verifiedEvent, city: undefined, region: undefined, country: undefined, location_status: 'tbd' };
  }
  const structuredText = structured.map((candidate) => {
    const $ = cheerio.load(candidate);
    try { return JSON.stringify(JSON.parse($('script').text())); } catch { return ''; }
  }).join(' ');
  if (event.description && !text.includes(normalized(event.description)) &&
      !normalized(structuredText).includes(normalized(event.description))) {
    verifiedEvent.description = undefined;
    warnings.push('Description was omitted because it was not a source excerpt');
  }
  if (event.sponsoredBy && !text.includes(normalized(event.sponsoredBy))) {
    verifiedEvent.sponsoredBy = undefined;
    verifiedEvent.sponsorKind = undefined;
    warnings.push('Unsupported sponsor was omitted');
  }
  if (event.url && !sourceHasUrl([scope || '', ...structured].join('\n'), event.url, sourceUrl)) {
    verifiedEvent.url = undefined;
    warnings.push('Event URL was omitted because it was not linked by the source');
  }
  return { verified: reasons.length === 0, reasons, warnings, event: verifiedEvent };
}

export function verifyExtractedEvents(events: ExtractedEvent[], html: string, sourceUrl?: string): {
  events: ExtractedEvent[];
  rejected: Array<{ event: ExtractedEvent; reasons: string[] }>;
  warnings: Array<{ title: string; reasons: string[] }>;
} {
  const accepted: ExtractedEvent[] = [];
  const rejected: Array<{ event: ExtractedEvent; reasons: string[] }> = [];
  const warnings: Array<{ title: string; reasons: string[] }> = [];
  for (const event of events) {
    const assessment = assessEventEvidence(event, html, sourceUrl);
    if (assessment.warnings.length) warnings.push({ title: event.title, reasons: assessment.warnings });
    if (assessment.verified) accepted.push(assessment.event);
    else rejected.push({ event, reasons: assessment.reasons });
  }
  return { events: accepted, rejected, warnings };
}

function sourceHasUrl(html: string, candidate: string, sourceUrl?: string): boolean {
  function canonical(value: string): string | null {
    try {
      const url = new URL(value, sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
      }
      return url.toString();
    } catch { return null; }
  }
  const wanted = canonical(candidate);
  if (!wanted) return false;
  if (sourceUrl && wanted === canonical(sourceUrl)) return true;
  const $ = cheerio.load(html);
  let found = false;
  $('a[href],link[rel="canonical"]').each((_, element) => {
    if (canonical($(element).attr('href') || '') === wanted) found = true;
  });
  function walk(value: unknown) {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string' && canonical(record.url) === wanted) found = true;
    Object.values(record).forEach(walk);
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { walk(JSON.parse($(element).text())); } catch { /* Invalid structured data is not evidence. */ }
  });
  return found;
}

/** Only explicit source labels are accepted; a model-supplied timezone is not evidence. */
function sourceTimezone(text: string, start?: string, end?: string): string | null {
  const iana = text.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g) || [];
  for (const zone of iana) {
    if (DateTime.now().setZone(zone).isValid) return zone;
  }
  if (/\b(?:UTC|GMT)\b/.test(text)) return 'UTC';
  const eastern = text.match(/\b(?:EDT|EST|ET)\b|Eastern (?:Daylight |Standard )?Time/);
  if (eastern && start && end) {
    const zone = 'America/New_York';
    const bounds = [DateTime.fromISO(start, { zone }), DateTime.fromISO(end, { zone })];
    if (bounds.some((bound, index) => !bound.isValid || bound.getPossibleOffsets().length > 1 ||
      bound.toFormat("yyyy-MM-dd'T'HH:mm") !== [start, end][index].slice(0, 16))) return null;
    if (/^(?:EDT|Eastern Daylight Time)$/.test(eastern[0]) && bounds.some((bound) => bound.offset !== -240)) return null;
    if (/^(?:EST|Eastern Standard Time)$/.test(eastern[0]) && bounds.some((bound) => bound.offset !== -300)) return null;
    return zone;
  }
  return null;
}
