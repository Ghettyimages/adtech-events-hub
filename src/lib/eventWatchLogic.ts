/**
 * Pure Event Watch decisions: identity, diff, content skipping, summaries, and review.
 * Persistence lives in eventWatch.ts so these rules can be tested without a database.
 */

import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import type { ExtractedEvent } from './extractor/schema';
import {
  fingerprintFromNormalizedEvent,
  normalizeEventUrl,
  normalizeTitleForDedupe,
} from './dedupe';
import {
  TEMPORAL_KIND,
  formatYmdUtc,
  fromCsvRow,
  mergeAndNormalizeTemporal,
  normalizeEventForWrite,
  storedTemporalEquals,
  temporalFieldsForPrisma,
  type EventTemporalRow,
  type NormalizedEventTemporal,
} from './eventTemporal';
import { updateEventSchema } from './validation';

export const EVENT_WATCH_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_WATCH_CLAIM_STALE_MS = 30 * 60 * 1000;
/** Scheduler cadence is six hours; one missed run plus an hour is overdue. */
export const EVENT_WATCH_SCHEDULER_GRACE_MS = 7 * 60 * 60 * 1000;
export const EVENT_WATCH_DETAIL_PAGE_LIMIT = 8;
export const EVENT_WATCH_CRON_BUDGET_MS = 4 * 60 * 1000;
export const EVENT_WATCH_CRON_SOURCE_LIMIT = 8;
const MAX_FAILURE_BACKOFF_MS = 7 * EVENT_WATCH_DEFAULT_INTERVAL_MS;

const COMPARED_TEXT_FIELDS = ['title', 'location', 'city', 'region', 'country', 'description'] as const;
const TEMPORAL_FIELDS = ['start', 'end', 'temporalKind', 'timezone'] as const;

export type CheckTrigger = 'MANUAL' | 'SCHEDULED' | 'FORCE_FULL';
export type IdentityKind = 'SOURCE_ID' | 'EVENT_URL' | 'CONSERVATIVE' | 'AMBIGUOUS';

export type FieldChange = {
  field: string;
  before: string | null;
  after: string | null;
};

export type AssignedIdentity = {
  stableKey: string;
  identityKind: IdentityKind;
  ambiguous: boolean;
  dedicatedUrl: string | null;
  event: ExtractedEvent;
};

export type CalendarEventSnapshot = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  start: Date;
  end: Date;
  timezone: string | null;
  temporalKind: string;
  allDayStartDate: Date | null;
  allDayEndDate: Date | null;
  updatedAt: Date;
  status: string;
  dedupeFingerprint?: string | null;
  sponsoredBy?: string | null;
};

export type IdentitySnapshot = {
  stableKey: string;
  identityKind: string;
  eventId: string | null;
  pendingEventId: string | null;
  baselineEstablishedAt: Date | null;
  ambiguous: boolean;
};

export type ProposalSnapshot = {
  eventId: string;
  signature: string;
  reviewStatus: string;
};

export type CandidateSnapshot = {
  candidateKey: string;
  reviewStatus: string;
  pendingEventId: string | null;
};

export type SourceCheckState = {
  id: string;
  url: string;
  enabled: boolean;
  checkInterval: number;
  monitoringEndsAt: Date | null;
  failureCount: number;
  processedContentHash: string | null;
  lastFullScanAt: Date | null;
  fullVerificationIntervalMs: number;
  requiresBrowser: boolean;
  monitorDetailPages: boolean;
  scanClaimedAt: Date | null;
  nextCheckAt: Date | null;
};

export type SkipDecision = { skip: boolean; reason: string | null };

export function hashContent(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function looseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function presentText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s+/g, ' ');
}

/** Relevant event text with navigation, ads, cookie banners, and tracking params removed. */
export function extractRelevantContent(html: string): string {
  const $ = cheerio.load(html);
  $(
    'script, style, noscript, nav, footer, header, iframe, svg, form, [role="navigation"], [aria-label*="cookie" i], [id*="cookie" i], [class*="cookie" i], [class*="banner" i], [class*="advert" i], [id*="advert" i], [class*="ads" i], [class*="promo" i]'
  ).remove();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    const normalized = normalizeEventUrl(href);
    if (normalized) $(element).attr('href', normalized);
  });

  const main = $('main, article, [role="main"]').first();
  const text =
    main.length > 0 && presentText(main.text())
      ? main.text()
      : $('body').length
        ? $('body').text()
        : $.root().text();
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function extractDetailLinks(html: string, listingUrl: string, limit = EVENT_WATCH_DETAIL_PAGE_LIMIT): string[] {
  const $ = cheerio.load(html);
  const listing = normalizeEventUrl(listingUrl);
  const links: string[] = [];
  $('a[href]').each((_, element) => {
    if (links.length >= limit) return;
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
    let absolute: string;
    try {
      absolute = new URL(href, listingUrl).toString();
    } catch {
      return;
    }
    const normalized = normalizeEventUrl(absolute);
    if (!normalized || normalized === listing || links.includes(normalized)) return;
    if (!/^https?:\/\//i.test(normalized)) return;
    links.push(normalized);
  });
  return links.slice(0, limit);
}

export function combinedContentHash(listingHash: string, detailHashes: Record<string, string>): string {
  const details = Object.keys(detailHashes)
    .sort()
    .map((url) => `${normalizeEventUrl(url)}=${detailHashes[url]}`)
    .join('\n');
  return hashContent(`${listingHash}\n${details}`);
}

export function decideExtractionSkip(input: {
  forceFull: boolean;
  now: Date;
  lastFullScanAt: Date | null;
  fullVerificationIntervalMs: number;
  processedContentHash: string | null;
  httpStatus: number | null;
  conditionalValidatorsSent: boolean;
  contentHash: string | null;
  requiresBrowser: boolean;
  browserContentHash: string | null;
  monitorDetailPages: boolean;
  detailHashesMatch: boolean;
}): SkipDecision {
  if (input.forceFull) return { skip: false, reason: null };
  const verificationDue =
    !input.lastFullScanAt ||
    input.now.getTime() - input.lastFullScanAt.getTime() >= input.fullVerificationIntervalMs;
  if (verificationDue) return { skip: false, reason: null };

  const detailsOk = !input.monitorDetailPages || input.detailHashesMatch;
  if (!detailsOk) return { skip: false, reason: null };

  if (input.requiresBrowser) {
    if (
      input.browserContentHash &&
      input.processedContentHash &&
      input.browserContentHash === input.processedContentHash
    ) {
      return { skip: true, reason: 'Rendered event content matches the last successful check' };
    }
    return { skip: false, reason: null };
  }

  if (
    input.httpStatus === 304 &&
    input.conditionalValidatorsSent &&
    input.processedContentHash
  ) {
    return { skip: true, reason: 'HTTP 304 and a processed baseline exists' };
  }

  if (
    input.contentHash &&
    input.processedContentHash &&
    input.contentHash === input.processedContentHash
  ) {
    return { skip: true, reason: 'Relevant event content matches the last successful check' };
  }

  return { skip: false, reason: null };
}

function editionToken(title: string): string {
  const years = title.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  const edition = title.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:annual|edition)\b/i);
  return [...years, edition?.[1] ? `e${edition[1]}` : ''].filter(Boolean).join('-');
}

function titleIdentity(title: string): string {
  return normalizeTitleForDedupe(title)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)?\s+(?:annual|edition)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function conservativeKey(event: ExtractedEvent): string {
  return `title:${titleIdentity(event.title)}|edition:${editionToken(event.title)}`;
}

function sameEdition(title: string, event: ExtractedEvent): boolean {
  return titleIdentity(title) === titleIdentity(event.title) && editionToken(title) === editionToken(event.title);
}

export function assignIdentities(
  events: ExtractedEvent[],
  listingUrl: string,
  existing: Array<{ stableKey: string; lastStart?: string | null }> = []
): AssignedIdentity[] {
  const listing = normalizeEventUrl(listingUrl);
  const prelim = events.map((event) => {
    const sourceEventId = (event as ExtractedEvent & { sourceEventId?: string }).sourceEventId?.trim();
    if (sourceEventId) {
      return {
        event,
        identityKind: 'SOURCE_ID' as IdentityKind,
        stableKey: `src:${sourceEventId}`,
        dedicatedUrl: null as string | null,
        ambiguous: false,
      };
    }
    const url = normalizeEventUrl(event.url);
    if (url && url !== listing) {
      return {
        event,
        identityKind: 'EVENT_URL' as IdentityKind,
        stableKey: `url:${url}`,
        dedicatedUrl: url,
        ambiguous: false,
      };
    }
    return {
      event,
      identityKind: 'CONSERVATIVE' as IdentityKind,
      stableKey: conservativeKey(event),
      dedicatedUrl: null,
      ambiguous: false,
    };
  });

  const urlCounts = new Map<string, number>();
  for (const item of prelim) {
    if (item.identityKind === 'EVENT_URL' && item.dedicatedUrl) {
      urlCounts.set(item.dedicatedUrl, (urlCounts.get(item.dedicatedUrl) || 0) + 1);
    }
  }

  const resolved = prelim.map((item) => {
    if (item.identityKind === 'EVENT_URL' && item.dedicatedUrl && (urlCounts.get(item.dedicatedUrl) || 0) > 1) {
      return {
        ...item,
        identityKind: 'CONSERVATIVE' as IdentityKind,
        stableKey: conservativeKey(item.event),
        dedicatedUrl: null,
      };
    }
    return item;
  });

  const groups = new Map<string, number[]>();
  resolved.forEach((item, index) => {
    if (item.identityKind !== 'CONSERVATIVE') return;
    const indexes = groups.get(item.stableKey) || [];
    indexes.push(index);
    groups.set(item.stableKey, indexes);
  });

  const assigned = resolved.map((item) => ({ ...item }));
  for (const [key, indexes] of groups) {
    if (indexes.length < 2) continue;
    const ordered = [...indexes].sort((a, b) => (resolved[a].event.start || '').localeCompare(resolved[b].event.start || ''));
    const prior = existing
      .filter((identity) => identity.stableKey.startsWith(`${key}|seq:`))
      .map((identity) => ({
        ...identity,
        seq: Number(identity.stableKey.split('|seq:')[1] || 0),
      }))
      .sort((a, b) => (a.lastStart || '').localeCompare(b.lastStart || ''));
    const used = new Set<string>();
    ordered.forEach((index, position) => {
      const start = resolved[index].event.start || '';
      let match = prior.find((identity) => !used.has(identity.stableKey) && identity.lastStart && identity.lastStart === start);
      if (!match) {
        match = prior.find((identity) => !used.has(identity.stableKey) && identity.seq === position + 1);
      }
      const stableKey = match?.stableKey || `${key}|seq:${position + 1}`;
      used.add(stableKey);
      assigned[index] = {
        ...assigned[index],
        identityKind: 'AMBIGUOUS',
        ambiguous: true,
        stableKey,
        dedicatedUrl: null,
      };
    });
  }

  return assigned.map((item) => ({
    stableKey: item.stableKey,
    identityKind: item.identityKind,
    ambiguous: item.ambiguous,
    dedicatedUrl: item.dedicatedUrl,
    event: item.event,
  }));
}

export function matchCalendarEvent(
  identity: AssignedIdentity,
  calendarEvents: CalendarEventSnapshot[],
  persisted?: IdentitySnapshot | null
): { type: 'linked' | 'pending' | 'unique' | 'ambiguous' | 'none'; eventId?: string; eventIds?: string[] } {
  if (persisted?.eventId) return { type: 'linked', eventId: persisted.eventId };
  if (persisted?.pendingEventId) return { type: 'pending', eventId: persisted.pendingEventId };
  if (identity.ambiguous || identity.identityKind === 'AMBIGUOUS') {
    return { type: 'ambiguous', eventIds: [] };
  }
  if (identity.identityKind === 'SOURCE_ID') return { type: 'none' };

  if (identity.identityKind === 'EVENT_URL' && identity.dedicatedUrl) {
    const matches = calendarEvents.filter((event) => normalizeEventUrl(event.url) === identity.dedicatedUrl);
    if (matches.length === 1) return { type: 'unique', eventId: matches[0].id };
    if (matches.length > 1) return { type: 'ambiguous', eventIds: matches.map((event) => event.id) };
    return { type: 'none' };
  }

  const matches = calendarEvents.filter((event) => sameEdition(event.title, identity.event));
  if (matches.length === 1) return { type: 'unique', eventId: matches[0].id };
  if (matches.length > 1) return { type: 'ambiguous', eventIds: matches.map((event) => event.id) };

  const fingerprint = fingerprintFromNormalizedEvent({
    ...identity.event,
    url: identity.dedicatedUrl || undefined,
  });
  const byFingerprint = calendarEvents.filter((event) => event.dedupeFingerprint && event.dedupeFingerprint === fingerprint);
  if (byFingerprint.length === 1) return { type: 'unique', eventId: byFingerprint[0].id };
  return { type: 'none' };
}

type NormalizedComparable = {
  text: Partial<Record<(typeof COMPARED_TEXT_FIELDS)[number], string>>;
  url?: string;
  temporal?: NormalizedEventTemporal;
};

function temporalFromExtracted(event: ExtractedEvent): NormalizedEventTemporal | undefined {
  if (!event.start || !event.end) return undefined;
  try {
    const input = fromCsvRow({
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      temporal_kind: event.temporalKind,
    });
    return normalizeEventForWrite({
      ...input,
      timezone: input.temporalKind === TEMPORAL_KIND.TIMED ? event.timezone || input.timezone : null,
    });
  } catch {
    return undefined;
  }
}

function temporalFromCalendar(event: CalendarEventSnapshot): NormalizedEventTemporal {
  return {
    temporalKind: event.temporalKind === TEMPORAL_KIND.TIMED ? TEMPORAL_KIND.TIMED : TEMPORAL_KIND.ALL_DAY,
    start: new Date(event.start),
    end: new Date(event.end),
    timezone: event.temporalKind === TEMPORAL_KIND.TIMED ? event.timezone : null,
    allDayStartDate: event.allDayStartDate ? new Date(event.allDayStartDate) : null,
    allDayEndDate: event.allDayEndDate ? new Date(event.allDayEndDate) : null,
  };
}

export function comparableFromExtracted(event: ExtractedEvent): NormalizedComparable {
  const text: NormalizedComparable['text'] = {};
  for (const field of COMPARED_TEXT_FIELDS) {
    const value = presentText(event[field]);
    if (value) text[field] = value;
  }
  const url = presentText(event.url);
  return {
    text,
    url: url ? normalizeEventUrl(url) : undefined,
    temporal: temporalFromExtracted(event),
  };
}

export function comparableFromCalendar(event: CalendarEventSnapshot): NormalizedComparable {
  const text: NormalizedComparable['text'] = {};
  for (const field of COMPARED_TEXT_FIELDS) {
    const value = presentText(event[field]);
    if (value) text[field] = value;
  }
  const url = presentText(event.url);
  return {
    text,
    url: url ? normalizeEventUrl(url) : undefined,
    temporal: temporalFromCalendar(event),
  };
}

function displayTemporal(temporal: NormalizedEventTemporal): Record<(typeof TEMPORAL_FIELDS)[number], string | null> {
  if (temporal.temporalKind === TEMPORAL_KIND.ALL_DAY) {
    return {
      start: formatYmdUtc(temporal.allDayStartDate ?? temporal.start),
      end: formatYmdUtc(temporal.allDayEndDate ?? temporal.end),
      temporalKind: TEMPORAL_KIND.ALL_DAY,
      timezone: null,
    };
  }
  return {
    start: temporal.start.toISOString(),
    end: temporal.end.toISOString(),
    temporalKind: TEMPORAL_KIND.TIMED,
    timezone: temporal.timezone,
  };
}

export function diffComparables(previous: NormalizedComparable, next: NormalizedComparable): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of COMPARED_TEXT_FIELDS) {
    const after = next.text[field];
    if (!after) continue;
    const before = previous.text[field];
    if (before && looseText(before) === looseText(after)) continue;
    changes.push({ field, before: before || null, after });
  }
  if (next.url && next.url !== previous.url) {
    changes.push({ field: 'url', before: previous.url || null, after: next.url });
  }
  if (next.temporal && !previous.temporal) {
    const after = displayTemporal(next.temporal);
    for (const field of TEMPORAL_FIELDS) {
      if (!after[field]) continue;
      changes.push({ field, before: null, after: after[field] });
    }
  } else if (next.temporal && previous.temporal && !storedTemporalEquals(previous.temporal, next.temporal)) {
    const before = displayTemporal(previous.temporal);
    const after = displayTemporal(next.temporal);
    for (const field of TEMPORAL_FIELDS) {
      if ((before[field] || null) === (after[field] || null)) continue;
      changes.push({ field, before: before[field], after: after[field] });
    }
  }
  return changes;
}

export function proposalSignature(eventId: string, changes: FieldChange[]): string {
  const body = changes
    .map((change) => `${change.field}=${looseText(change.after || '')}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(`${eventId}\n${body}`, 'utf8').digest('hex');
}

export function proposalIsBlocked(reviewStatus: string): boolean {
  return reviewStatus === 'PENDING' || reviewStatus === 'APPROVED' || reviewStatus === 'REJECTED';
}

export function shouldOpenProposal(existing: ProposalSnapshot[], eventId: string, signature: string): boolean {
  return !existing.some(
    (proposal) =>
      proposal.eventId === eventId && proposal.signature === signature && proposalIsBlocked(proposal.reviewStatus)
  );
}

export function contentFingerprint(event: ExtractedEvent): string {
  const comparable = comparableFromExtracted(event);
  return hashContent(JSON.stringify(comparable));
}

export type ScanSummaryInput = {
  httpStatus: number | null;
  retrievalFailed: boolean;
  blocked: boolean;
  partial: boolean;
  emptyUnverified: boolean;
  extractionRan: boolean;
  skippedUnchanged: boolean;
  newEvents: number;
  changedEvents: number;
  discrepancies: number;
  baselinesEstablished: number;
  unchangedEvents: number;
};

export function summarizeCheck(input: ScanSummaryInput): { outcome: string; summary: string } {
  if (input.retrievalFailed) return { outcome: 'FAILED', summary: 'Scan failed' };
  if (input.blocked || input.partial || input.emptyUnverified) {
    return { outcome: 'INCOMPLETE', summary: 'Could not verify event details' };
  }
  if (input.httpStatus != null && input.httpStatus >= 500) {
    return { outcome: 'FAILED', summary: 'Scan failed' };
  }
  if (input.skippedUnchanged) return { outcome: 'NO_CHANGES', summary: 'No changes found' };

  const parts: string[] = [];
  if (input.newEvents > 0) {
    parts.push(`${input.newEvents} new event${input.newEvents === 1 ? '' : 's'}`);
  }
  if (input.changedEvents > 0) {
    parts.push(`${input.changedEvents} changed event${input.changedEvents === 1 ? '' : 's'}`);
  }
  if (input.discrepancies > 0) {
    parts.push(
      `${input.discrepancies} discrepanc${input.discrepancies === 1 ? 'y' : 'ies'} to review`
    );
  }
  if (input.baselinesEstablished > 0 && parts.length === 0) {
    return { outcome: 'SUCCESS', summary: 'Baseline established' };
  }
  if (input.baselinesEstablished > 0) parts.push('Baseline established');
  if (parts.length === 0 && input.extractionRan) {
    return { outcome: 'NO_CHANGES', summary: 'No changes found' };
  }
  if (parts.length === 0) return { outcome: 'INCOMPLETE', summary: 'Could not verify event details' };
  return { outcome: 'SUCCESS', summary: parts.join(' · ') };
}

export function isDueForScheduledCheck(source: SourceCheckState, now: Date): boolean {
  if (!source.enabled) return false;
  if (source.monitoringEndsAt && source.monitoringEndsAt < now) return false;
  if (source.nextCheckAt && source.nextCheckAt > now) return false;
  return true;
}

export function isOverdue(source: SourceCheckState, now: Date): boolean {
  if (!isDueForScheduledCheck(source, now) || !source.nextCheckAt) return false;
  return source.nextCheckAt.getTime() < now.getTime() - EVENT_WATCH_SCHEDULER_GRACE_MS;
}

export function sortDueSources<T extends SourceCheckState>(sources: T[]): T[] {
  return [...sources].sort((a, b) => {
    if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
    const aDue = a.nextCheckAt?.getTime() ?? 0;
    const bDue = b.nextCheckAt?.getTime() ?? 0;
    return aDue - bDue;
  });
}

export function canClaim(source: { scanClaimedAt: Date | null }, now: Date): boolean {
  if (!source.scanClaimedAt) return true;
  return now.getTime() - source.scanClaimedAt.getTime() >= EVENT_WATCH_CLAIM_STALE_MS;
}

export function claimSource<T extends { scanClaimedAt: Date | null; scanClaimToken?: string | null }>(
  source: T,
  now: Date,
  token: string
): { claimed: boolean; source: T } {
  if (!canClaim(source, now)) return { claimed: false, source };
  return { claimed: true, source: { ...source, scanClaimedAt: now, scanClaimToken: token } };
}

export function isAbandonedScan(scan: { status: string; startedAt: Date }, now: Date): boolean {
  return scan.status === 'RUNNING' && now.getTime() - scan.startedAt.getTime() >= EVENT_WATCH_CLAIM_STALE_MS;
}

export function nextCheckAtForSource(
  source: SourceCheckState,
  finishedAt: Date,
  failureCount: number,
  failed: boolean
): Date | null {
  if (!source.enabled) return null;
  if (source.monitoringEndsAt && finishedAt > source.monitoringEndsAt) return null;
  const delay = failed
    ? Math.min(source.checkInterval * Math.pow(2, Math.min(failureCount, 6)), MAX_FAILURE_BACKOFF_MS)
    : source.checkInterval;
  const next = new Date(finishedAt.getTime() + delay);
  if (source.monitoringEndsAt && next > source.monitoringEndsAt) return null;
  return next;
}

export type BuiltObservation = {
  stableKey: string;
  contentFingerprint: string;
  payload: ExtractedEvent;
  sourceUrl: string;
  evidence: string | null;
};

export type BuiltProposal = {
  stableKey: string;
  eventId: string;
  kind: 'SOURCE_CHANGE' | 'DISCREPANCY';
  previousValues: Record<string, string | null>;
  proposedValues: Record<string, string | null>;
  changedFields: string[];
  changes: FieldChange[];
  sourceUrl: string;
  evidence: string | null;
  signature: string;
  eventUpdatedAtSnapshot: Date;
};

export type BuiltCandidate = {
  stableKey: string;
  matchStatus: 'NEW_EVENT' | 'AMBIGUOUS';
  sourceUrl: string;
  evidence: string | null;
  payload: ExtractedEvent;
};

export type BuiltPendingEvent = {
  stableKey: string;
  event: ExtractedEvent;
  storageUrl: string | null;
};

export type BuildCheckInput = {
  now: Date;
  trigger: CheckTrigger;
  source: SourceCheckState;
  httpStatus: number | null;
  conditionalValidatorsSent: boolean;
  contentHash: string | null;
  browserContentHash: string | null;
  detailHashesMatch: boolean;
  fetchedEtag: string | null;
  fetchedLastModified: string | null;
  extraction: { ok: true; events: ExtractedEvent[]; method: string } | { ok: false; error: string } | null;
  partial: boolean;
  calendarEvents: CalendarEventSnapshot[];
  identities: IdentitySnapshot[];
  latestPayloadByKey: Record<string, ExtractedEvent>;
  proposals: ProposalSnapshot[];
  candidates: CandidateSnapshot[];
  existingIdentityStarts: Array<{ stableKey: string; lastStart?: string | null }>;
};

export type BuildCheckResult = {
  outcome: string;
  summary: string;
  fullExtractionRan: boolean;
  skipReason: string | null;
  newEvents: number;
  changedEvents: number;
  discrepancies: number;
  unchangedEvents: number;
  baselinesEstablished: number;
  eventsFound: number;
  error: string | null;
  extractionMethod: string | null;
  advanceProcessedBaseline: boolean;
  observations: BuiltObservation[];
  proposals: BuiltProposal[];
  candidates: BuiltCandidate[];
  pendingEvents: BuiltPendingEvent[];
  identityLinks: Array<{
    stableKey: string;
    identityKind: string;
    ambiguous: boolean;
    eventId: string | null;
    attachPending: boolean;
    establishBaseline: boolean;
  }>;
  nextCheckAt: Date | null;
  failureCount: number;
  lastError: string | null;
  succeeded: boolean;
};

function evidenceText(event: ExtractedEvent): string | null {
  return (
    [event.evidence, event.evidence_context, event.location_evidence, event.location_evidence_context]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join('\n\n') || null
  );
}

function valuesFromChanges(changes: FieldChange[], side: 'before' | 'after'): Record<string, string | null> {
  return Object.fromEntries(changes.map((change) => [change.field, change[side]]));
}

export function buildCheckRecords(input: BuildCheckInput): BuildCheckResult {
  const forceFull = input.trigger === 'FORCE_FULL';
  const blocked = input.httpStatus === 401 || input.httpStatus === 403 || input.httpStatus === 429;
  const retrievalFailed = input.httpStatus != null && input.httpStatus >= 400 && !blocked;

  const skip = decideExtractionSkip({
    forceFull,
    now: input.now,
    lastFullScanAt: input.source.lastFullScanAt,
    fullVerificationIntervalMs: input.source.fullVerificationIntervalMs,
    processedContentHash: input.source.processedContentHash,
    httpStatus: input.httpStatus,
    conditionalValidatorsSent: input.conditionalValidatorsSent,
    contentHash: input.source.requiresBrowser ? null : input.contentHash,
    requiresBrowser: input.source.requiresBrowser,
    browserContentHash: input.browserContentHash,
    monitorDetailPages: input.source.monitorDetailPages,
    detailHashesMatch: input.detailHashesMatch,
  });

  const base = {
    observations: [] as BuiltObservation[],
    proposals: [] as BuiltProposal[],
    candidates: [] as BuiltCandidate[],
    pendingEvents: [] as BuiltPendingEvent[],
    identityLinks: [] as BuildCheckResult['identityLinks'],
    newEvents: 0,
    changedEvents: 0,
    discrepancies: 0,
    unchangedEvents: 0,
    baselinesEstablished: 0,
    eventsFound: 0,
    extractionMethod: null as string | null,
    fullExtractionRan: false,
    skipReason: null as string | null,
    advanceProcessedBaseline: false,
  };

  const finish = (
    summaryInput: ScanSummaryInput,
    error: string | null,
    succeeded: boolean
  ): BuildCheckResult => {
    const summary = summarizeCheck(summaryInput);
    const failed = !succeeded;
    const failureCount = failed ? input.source.failureCount + 1 : 0;
    return {
      ...base,
      ...summary,
      error,
      nextCheckAt: nextCheckAtForSource(input.source, input.now, failureCount, failed),
      failureCount,
      lastError: error,
      succeeded,
    };
  };

  if (retrievalFailed || blocked || input.partial) {
    return finish(
      {
        httpStatus: input.httpStatus,
        retrievalFailed,
        blocked,
        partial: input.partial,
        emptyUnverified: false,
        extractionRan: false,
        skippedUnchanged: false,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: 0,
      },
      retrievalFailed ? `HTTP ${input.httpStatus}` : input.partial ? 'Check did not finish' : 'Source blocked the check',
      false
    );
  }

  if (input.httpStatus === 304 && !skip.skip) {
    return finish(
      {
        httpStatus: 304,
        retrievalFailed: false,
        blocked: false,
        partial: false,
        emptyUnverified: true,
        extractionRan: false,
        skippedUnchanged: false,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: 0,
      },
      'Conditional response had no processed baseline',
      false
    );
  }

  if (skip.skip) {
    base.skipReason = skip.reason;
    base.unchangedEvents = input.identities.filter((identity) => identity.baselineEstablishedAt).length;
    return finish(
      {
        httpStatus: input.httpStatus,
        retrievalFailed: false,
        blocked: false,
        partial: false,
        emptyUnverified: false,
        extractionRan: false,
        skippedUnchanged: true,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: base.unchangedEvents,
      },
      null,
      true
    );
  }

  if (!input.extraction) {
    return finish(
      {
        httpStatus: input.httpStatus,
        retrievalFailed: false,
        blocked: false,
        partial: false,
        emptyUnverified: true,
        extractionRan: false,
        skippedUnchanged: false,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: 0,
      },
      'Event details were not extracted',
      false
    );
  }

  if (!input.extraction.ok) {
    base.fullExtractionRan = true;
    return finish(
      {
        httpStatus: input.httpStatus,
        retrievalFailed: true,
        blocked: false,
        partial: false,
        emptyUnverified: false,
        extractionRan: true,
        skippedUnchanged: false,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: 0,
      },
      input.extraction.error,
      false
    );
  }

  base.fullExtractionRan = true;
  base.extractionMethod = input.extraction.method;
  const upcoming = input.extraction.events.filter((event) => {
    const end = new Date(event.end || event.start || '');
    return event.title && event.start && event.end && !Number.isNaN(end.getTime()) && end >= input.now;
  });
  base.eventsFound = input.extraction.events.length;

  const hadBaseline = input.identities.some((identity) => identity.baselineEstablishedAt);
  if (upcoming.length === 0) {
    return finish(
      {
        httpStatus: input.httpStatus,
        retrievalFailed: false,
        blocked: false,
        partial: false,
        emptyUnverified: true,
        extractionRan: true,
        skippedUnchanged: false,
        newEvents: 0,
        changedEvents: 0,
        discrepancies: 0,
        baselinesEstablished: 0,
        unchangedEvents: 0,
      },
      hadBaseline
        ? 'Extraction returned no events after a previous baseline. Nothing was removed.'
        : 'Extraction did not return verifiable events',
      false
    );
  }

  const identities = assignIdentities(upcoming, input.source.url, input.existingIdentityStarts);
  for (const identity of identities) {
    const fingerprint = contentFingerprint(identity.event);
    const evidence = evidenceText(identity.event);
    base.observations.push({
      stableKey: identity.stableKey,
      contentFingerprint: fingerprint,
      payload: identity.event,
      sourceUrl: identity.dedicatedUrl || input.source.url,
      evidence,
    });
    const persisted = input.identities.find((item) => item.stableKey === identity.stableKey);
    const match = matchCalendarEvent(identity, input.calendarEvents, persisted);
    const previousPayload = input.latestPayloadByKey[identity.stableKey];
    const establishBaseline = !persisted?.baselineEstablishedAt;

    if (match.type === 'ambiguous' || identity.ambiguous) {
      const existingCandidate = input.candidates.find((candidate) => candidate.candidateKey === identity.stableKey);
      if (!existingCandidate) {
        base.candidates.push({
          stableKey: identity.stableKey,
          matchStatus: 'AMBIGUOUS',
          sourceUrl: input.source.url,
          evidence,
          payload: identity.event,
        });
      }
      base.identityLinks.push({
        stableKey: identity.stableKey,
        identityKind: 'AMBIGUOUS',
        ambiguous: true,
        eventId: persisted?.eventId || null,
        attachPending: false,
        establishBaseline: false,
      });
      continue;
    }

    if ((match.type === 'linked' || match.type === 'unique') && match.eventId) {
      const calendar = input.calendarEvents.find((event) => event.id === match.eventId);
      if (!calendar) continue;
      if (establishBaseline || !previousPayload) {
        if (establishBaseline) base.baselinesEstablished += 1;
        const changes = diffComparables(comparableFromCalendar(calendar), comparableFromExtracted(identity.event));
        if (changes.length > 0) {
          const signature = proposalSignature(calendar.id, changes);
          if (shouldOpenProposal(input.proposals, calendar.id, signature)) {
            base.discrepancies += 1;
            base.proposals.push({
              stableKey: identity.stableKey,
              eventId: calendar.id,
              kind: 'DISCREPANCY',
              previousValues: valuesFromChanges(changes, 'before'),
              proposedValues: valuesFromChanges(changes, 'after'),
              changedFields: changes.map((change) => change.field),
              changes,
              sourceUrl: identity.dedicatedUrl || input.source.url,
              evidence,
              signature,
              eventUpdatedAtSnapshot: calendar.updatedAt,
            });
          }
        } else {
          base.unchangedEvents += 1;
        }
      } else if (previousPayload) {
        const changes = diffComparables(
          comparableFromExtracted(previousPayload),
          comparableFromExtracted(identity.event)
        );
        if (changes.length === 0) {
          base.unchangedEvents += 1;
        } else {
          const signature = proposalSignature(calendar.id, changes);
          if (shouldOpenProposal(input.proposals, calendar.id, signature)) {
            base.changedEvents += 1;
            base.proposals.push({
              stableKey: identity.stableKey,
              eventId: calendar.id,
              kind: 'SOURCE_CHANGE',
              previousValues: valuesFromChanges(changes, 'before'),
              proposedValues: valuesFromChanges(changes, 'after'),
              changedFields: changes.map((change) => change.field),
              changes,
              sourceUrl: identity.dedicatedUrl || input.source.url,
              evidence,
              signature,
              eventUpdatedAtSnapshot: calendar.updatedAt,
            });
          }
        }
      }
      base.identityLinks.push({
        stableKey: identity.stableKey,
        identityKind: identity.identityKind,
        ambiguous: false,
        eventId: calendar.id,
        attachPending: false,
        establishBaseline: true,
      });
      continue;
    }

    if (match.type === 'pending') {
      base.unchangedEvents += 1;
      base.identityLinks.push({
        stableKey: identity.stableKey,
        identityKind: identity.identityKind,
        ambiguous: false,
        eventId: null,
        attachPending: false,
        establishBaseline: true,
      });
      continue;
    }

    const existingCandidate = input.candidates.find((candidate) => candidate.candidateKey === identity.stableKey);
    if (existingCandidate) {
      base.identityLinks.push({
        stableKey: identity.stableKey,
        identityKind: identity.identityKind,
        ambiguous: false,
        eventId: null,
        attachPending: false,
        establishBaseline: true,
      });
      continue;
    }

    base.newEvents += 1;
    base.candidates.push({
      stableKey: identity.stableKey,
      matchStatus: 'NEW_EVENT',
      sourceUrl: identity.dedicatedUrl || input.source.url,
      evidence,
      payload: identity.event,
    });
    base.pendingEvents.push({
      stableKey: identity.stableKey,
      event: { ...identity.event, url: identity.dedicatedUrl || undefined },
      storageUrl: identity.dedicatedUrl,
    });
    base.identityLinks.push({
      stableKey: identity.stableKey,
      identityKind: identity.identityKind,
      ambiguous: false,
      eventId: null,
      attachPending: true,
      establishBaseline: true,
    });
    base.baselinesEstablished += 1;
  }

  base.advanceProcessedBaseline = true;
  return finish(
    {
      httpStatus: input.httpStatus,
      retrievalFailed: false,
      blocked: false,
      partial: false,
      emptyUnverified: false,
      extractionRan: true,
      skippedUnchanged: false,
      newEvents: base.newEvents,
      changedEvents: base.changedEvents,
      discrepancies: base.discrepancies,
      baselinesEstablished: base.baselinesEstablished,
      unchangedEvents: base.unchangedEvents,
    },
    null,
    true
  );
}

export type ProposalReviewDecision =
  | { type: 'idempotent' }
  | { type: 'rejected' }
  | { type: 'conflict' }
  | { type: 'invalid'; message: string }
  | { type: 'apply'; data: Record<string, unknown> };

export function decideProposalReview(input: {
  action: 'approve' | 'reject';
  proposal: {
    reviewStatus: string;
    proposedValues: Record<string, string | null>;
    changedFields: string[];
    eventUpdatedAtSnapshot: Date;
  };
  event: CalendarEventSnapshot;
}): ProposalReviewDecision {
  if (input.proposal.reviewStatus === 'APPROVED') {
    return input.action === 'approve'
      ? { type: 'idempotent' }
      : { type: 'invalid', message: 'Proposal is no longer pending review' };
  }
  if (input.proposal.reviewStatus === 'REJECTED') {
    return input.action === 'reject' ? { type: 'idempotent' } : { type: 'invalid', message: 'Proposal is no longer pending review' };
  }
  if (input.proposal.reviewStatus !== 'PENDING') {
    return { type: 'invalid', message: 'Proposal is no longer pending review' };
  }
  if (input.action === 'reject') return { type: 'rejected' };
  if (input.event.updatedAt.getTime() > input.proposal.eventUpdatedAtSnapshot.getTime()) {
    return { type: 'conflict' };
  }

  const proposed = input.proposal.proposedValues;
  const changed = new Set(input.proposal.changedFields);
  const data: Record<string, unknown> = {};
  for (const field of ['title', 'description', 'location', 'city', 'region', 'country', 'url'] as const) {
    if (!changed.has(field)) continue;
    const value = proposed[field];
    if (value == null || value === '') continue;
    data[field] = value;
  }

  const temporalChanged = ['start', 'end', 'temporalKind', 'timezone'].some((field) => changed.has(field));
  if (temporalChanged) {
    const existing: EventTemporalRow = input.event;
    try {
      const normalized = mergeAndNormalizeTemporal(
        {
          start: proposed.start || undefined,
          end: proposed.end || undefined,
          timezone: proposed.timezone,
          temporalKind:
            proposed.temporalKind === TEMPORAL_KIND.TIMED || proposed.temporalKind === TEMPORAL_KIND.ALL_DAY
              ? proposed.temporalKind
              : undefined,
        },
        existing
      );
      Object.assign(data, temporalFieldsForPrisma(normalized));
    } catch (error) {
      return { type: 'invalid', message: error instanceof Error ? error.message : 'Invalid event dates' };
    }
  }

  const validationPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) continue;
    validationPayload[key] = value;
  }
  if (temporalChanged) {
    if (typeof proposed.start === 'string') validationPayload.start = proposed.start;
    if (typeof proposed.end === 'string') validationPayload.end = proposed.end;
    if (proposed.temporalKind) validationPayload.temporalKind = proposed.temporalKind;
    if (proposed.timezone) validationPayload.timezone = proposed.timezone;
  }
  const parsed = updateEventSchema.safeParse(validationPayload);
  if (!parsed.success) {
    return { type: 'invalid', message: 'Proposed event details did not pass validation' };
  }
  return { type: 'apply', data };
}

export function monitoringAllowsScheduledCheck(source: { enabled: boolean; monitoringEndsAt: Date | null }, now: Date): boolean {
  return isDueForScheduledCheck(
    {
      id: '',
      url: '',
      enabled: source.enabled,
      checkInterval: 1,
      monitoringEndsAt: source.monitoringEndsAt,
      failureCount: 0,
      processedContentHash: null,
      lastFullScanAt: new Date(0),
      fullVerificationIntervalMs: 1,
      requiresBrowser: false,
      monitorDetailPages: false,
      scanClaimedAt: null,
      nextCheckAt: null,
    },
    now
  );
}
