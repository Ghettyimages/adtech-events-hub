import 'server-only';

import { randomUUID } from 'crypto';
import type { Event, MonitoredUrl, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isIsolatedDatabaseEnvironment } from '@/lib/database-url';
import type { ExtractedEvent } from '@/lib/extractor/schema';
import { extractEventsFromUrl } from '@/lib/extractor/agent';
import { scrapeUrlGenericWithVerification } from '@/lib/scraper';
import { markdownToOverrideHtml, scrapeUrlWithFirecrawl } from '@/lib/firecrawl';
import { fingerprintFromNormalizedEvent } from '@/lib/dedupe';
import { normalize_events } from '@/lib/tools';
import { assertSafePublicHttpUrl, safePublicFetch } from '@/lib/safeRemoteUrl';
import { getRenderedHTML } from '@/lib/render';
import { processAllFilterSubscriptionsForEvent } from '@/lib/filters-server';
import { fromCsvRow, normalizeEventForWrite, temporalFieldsForPrisma } from '@/lib/eventTemporal';
import {
  EVENT_WATCH_CLAIM_STALE_MS,
  EVENT_WATCH_CRON_BUDGET_MS,
  EVENT_WATCH_CRON_SOURCE_LIMIT,
  EVENT_WATCH_DETAIL_PAGE_LIMIT,
  buildCheckRecords,
  canClaim,
  claimSource,
  combinedContentHash,
  decideExtractionSkip,
  decideProposalReview,
  nextCheckAtForSource,
  extractDetailLinks,
  extractRelevantContent,
  fullVerificationDue,
  hashContent,
  isDueForScheduledCheck,
  isOverdue,
  sortDueSources,
  type CalendarEventSnapshot,
  type CheckTrigger,
  type SourceCheckState,
} from '@/lib/eventWatchLogic';

export {
  EVENT_WATCH_DEFAULT_INTERVAL_MS,
  EVENT_WATCH_FULL_VERIFICATION_INTERVAL_MS,
  EVENT_WATCH_SCHEDULER_GRACE_MS,
} from '@/lib/eventWatchLogic';

type ExtractionMethod = 'agent' | 'generic' | 'firecrawl-agent';

// A prior baseline did not cover the same fields or evidence rules.
const BASELINE_VERSION = 'v2:';
function currentBaseline(hash: string | null) {
  return hash?.startsWith(BASELINE_VERSION) ? hash : null;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceState(source: MonitoredUrl): SourceCheckState {
  return {
    id: source.id,
    url: source.url,
    enabled: source.enabled,
    checkInterval: source.checkInterval,
    monitoringEndsAt: source.monitoringEndsAt,
    failureCount: source.failureCount,
    processedContentHash: currentBaseline(source.processedContentHash),
    lastFullScanAt: source.lastFullScanAt,
    fullVerificationIntervalMs: source.fullVerificationIntervalMs,
    requiresBrowser: source.requiresBrowser,
    monitorDetailPages: source.monitorDetailPages,
    scanClaimedAt: source.scanClaimedAt,
    nextCheckAt: source.nextCheckAt,
  };
}

export function sourceWatchStatus(source: MonitoredUrl, now = new Date()) {
  const state = sourceState(source);
  if (!source.enabled) return 'disabled';
  if (source.monitoringEndsAt && source.monitoringEndsAt < now) return 'ended';
  if (source.scanClaimedAt && !canClaim(source, now)) return 'checking';
  if (isOverdue(state, now)) return 'overdue';
  if (source.lastError) return 'failed';
  return 'active';
}

function calendarSnapshot(event: Event): CalendarEventSnapshot {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    url: event.url,
    location: event.location,
    city: event.city,
    region: event.region,
    country: event.country,
    start: event.start,
    end: event.end,
    timezone: event.timezone,
    temporalKind: event.temporalKind,
    allDayStartDate: event.allDayStartDate,
    allDayEndDate: event.allDayEndDate,
    updatedAt: event.updatedAt,
    status: event.status,
    dedupeFingerprint: event.dedupeFingerprint,
    sponsoredBy: event.sponsoredBy,
  };
}

async function extractSourceEvents(source: MonitoredUrl, html: string, allowRemoteFallback = true): Promise<{
  events: ExtractedEvent[];
  method: ExtractionMethod;
  partial: boolean;
  baselineMatches: boolean;
  issue?: string;
}> {
  let agentEvents: ExtractedEvent[] = [];
  try {
    const result = await extractEventsFromUrl(source.url, source.name || new URL(source.url).hostname, html);
    agentEvents = result.events || [];
    if (result.rejectedEvents) return { events: agentEvents, method: 'agent', partial: true, baselineMatches: true, issue: result.verificationIssues?.[0]?.reasons[0] };
  } catch (error) {
    console.warn(`[event-watch] Agent extraction failed for ${source.url}`, error);
  }
  if (agentEvents.length > 0) return { events: agentEvents, method: 'agent', partial: false, baselineMatches: true };

  const generic = await scrapeUrlGenericWithVerification(source.url, source.name || undefined, html);
  if (generic.rejectedEvents || generic.events.length > 0) return {
    events: generic.events, method: 'generic', partial: generic.rejectedEvents > 0, baselineMatches: true,
    issue: generic.verificationIssues[0]?.reasons[0],
  };
  if (!allowRemoteFallback) return { events: [], method: 'generic', partial: false, baselineMatches: true };

  const firecrawl = await scrapeUrlWithFirecrawl(source.url);
  const overrideHtml =
    firecrawl.html || (firecrawl.markdown ? markdownToOverrideHtml(firecrawl.markdown) : undefined);
  if (overrideHtml) {
    const result = await extractEventsFromUrl(
      source.url,
      source.name || new URL(source.url).hostname,
      overrideHtml
    );
    if (result.rejectedEvents || result.events?.length) return {
      events: result.events || [], method: 'firecrawl-agent', partial: Boolean(result.rejectedEvents), baselineMatches: false,
      issue: result.verificationIssues?.[0]?.reasons[0],
    };
  }

  if (firecrawl.error) throw new Error(firecrawl.error);
  return { events: [], method: 'generic', partial: false, baselineMatches: true };
}

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

async function withinTimeBudget<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Event check exceeded its time budget')), Math.max(1, timeoutMs));
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Extract each captured page under its own URL so evidence is never borrowed
 * from a different event. Detail checks share the caller's extraction deadline. */
async function extractCapturedSourceEvents(
  source: MonitoredUrl,
  html: string,
  details: Array<{ url: string; html: string }>
) {
  const listing = await extractSourceEvents(source, html, details.length === 0);
  if (listing.partial) return listing;
  const merged = new Map<string, ExtractedEvent>();
  const eventKey = (event: ExtractedEvent) =>
    `${event.title.trim().toLowerCase().replace(/\s+/g, ' ')}|${event.start}|${event.end}`;
  for (const event of listing.events) merged.set(eventKey(event), event);
  let partial = false;
  let issue: string | undefined;
  for (const detail of details) {
    const extracted = await extractSourceEvents({ ...source, url: detail.url }, detail.html, false);
    if (extracted.partial || extracted.events.length === 0) {
      partial = true;
      issue ||= extracted.issue || 'A linked event page did not yield verifiable event details';
    }
    for (const event of extracted.events) {
      // A dedicated detail URL is preferable to the shared agenda URL.
      const observed = !event.url || event.url === source.url ? { ...event, url: detail.url } : event;
      merged.set(eventKey(observed), observed);
    }
  }
  return { ...listing, events: [...merged.values()], partial, issue,
    method: details.length ? 'agent' as ExtractionMethod : listing.method };
}

function parseDetailHashes(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

async function hashDetailPages(links: string[], stored: Record<string, string>) {
  const next: Record<string, string> = {};
  const snapshots: Array<{ url: string; html: string }> = [];
  let detailHashesMatch = links.length > 0;
  let partial = false;
  await mapPool(links, 2, async (link) => {
    try {
      await assertSafePublicHttpUrl(link);
      const detail = await safePublicFetch(link, { signal: AbortSignal.timeout(15_000) });
      if (!detail.ok) {
        partial = true;
        detailHashesMatch = false;
        return;
      }
      const html = await detail.text();
      const text = extractRelevantContent(html);
      if (!text) {
        partial = true;
        detailHashesMatch = false;
        return;
      }
      const detailHash = hashContent(text);
      if (!stored[link] || stored[link] !== detailHash) detailHashesMatch = false;
      next[link] = detailHash;
      snapshots.push({ url: link, html });
    } catch (error) {
      console.warn(`[event-watch] Detail page check failed for ${link}`, error);
      partial = true;
      detailHashesMatch = false;
    }
  });
  return { next, detailHashesMatch, partial, snapshots };
}

async function loadSourceContent(source: MonitoredUrl, forceFull: boolean) {
  const storedDetails = parseDetailHashes(source.detailPageHashes);
  // A static shell or validator is not evidence for a JavaScript agenda.
  const allowConditional = !forceFull && !fullVerificationDue(source, new Date()) &&
    !source.requiresBrowser && Boolean(currentBaseline(source.processedContentHash));
  const headers: Record<string, string> = {
    'User-Agent': 'TheMediaCalendar Event Watch',
    Accept: 'text/html,application/xhtml+xml',
  };
  let conditionalValidatorsSent = false;
  if (allowConditional && source.processedHttpEtag) {
    headers['If-None-Match'] = source.processedHttpEtag;
    conditionalValidatorsSent = true;
  } else if (allowConditional && source.processedHttpLastModified) {
    headers['If-Modified-Since'] = source.processedHttpLastModified;
    conditionalValidatorsSent = true;
  }

  const response = await safePublicFetch(source.url, { headers, signal: AbortSignal.timeout(15_000) });
  const fetchedEtag = response.headers.get('etag');
  const fetchedLastModified = response.headers.get('last-modified');

  if (response.status === 304 && source.monitorDetailPages) {
    const links = Object.keys(storedDetails).slice(0, EVENT_WATCH_DETAIL_PAGE_LIMIT);
    if (links.length > 0) {
      const checked = await hashDetailPages(links, storedDetails);
      if (checked.detailHashesMatch && !checked.partial) {
        return {
          httpStatus: 304,
          conditionalValidatorsSent,
          contentHash: source.processedContentHash,
          browserContentHash: null as string | null,
          detailHashesMatch: true,
          fetchedEtag,
          fetchedLastModified,
          detailPageHashes: JSON.stringify(checked.next),
          partial: false,
          html: '',
          detailSnapshots: [],
        };
      }
    }
    if (!forceFull) return loadSourceContent(source, true);
    return {
      httpStatus: 304,
      conditionalValidatorsSent,
      contentHash: null,
      browserContentHash: null,
      detailHashesMatch: false,
      fetchedEtag,
      fetchedLastModified,
      detailPageHashes: source.detailPageHashes,
      partial: true,
      html: '',
      detailSnapshots: [],
    };
  }

  if (response.status === 304) {
    return {
      httpStatus: 304,
      conditionalValidatorsSent,
      contentHash: null as string | null,
      browserContentHash: null as string | null,
      detailHashesMatch: !source.monitorDetailPages,
      fetchedEtag,
      fetchedLastModified,
      detailPageHashes: source.detailPageHashes,
      partial: false,
      html: '',
      detailSnapshots: [],
    };
  }

  const html = response.ok ? await response.text() : '';
  let browserHtml = '';
  let browserContentHash: string | null = null;
  if (source.requiresBrowser && response.ok) {
    const rendered = await getRenderedHTML(source.url);
    browserHtml = rendered.html || '';
    const browserText = extractRelevantContent(browserHtml);
    browserContentHash = browserText ? hashContent(browserText) : null;
  }

  const relevant = html ? extractRelevantContent(html) : '';
  let contentHash = relevant ? hashContent(relevant) : null;
  let detailHashesMatch = true;
  let partial = false;
  const nextDetails = { ...storedDetails };
  let detailSnapshots: Array<{ url: string; html: string }> = [];
  const linkHtml = source.requiresBrowser ? browserHtml : html;
  if (source.monitorDetailPages && response.ok && linkHtml) {
    const links = extractDetailLinks(linkHtml, source.url, EVENT_WATCH_DETAIL_PAGE_LIMIT);
    const checked = await hashDetailPages(links, storedDetails);
    for (const key of Object.keys(nextDetails)) delete nextDetails[key];
    Object.assign(nextDetails, checked.next);
    detailSnapshots = checked.snapshots;
    detailHashesMatch = checked.detailHashesMatch;
    partial = checked.partial || links.length === 0;
    const unchecked = Object.keys(storedDetails).filter((url) => !links.includes(url));
    if (unchecked.length > 0 || links.length === 0) detailHashesMatch = false;
    if (source.requiresBrowser && browserContentHash) {
      browserContentHash = combinedContentHash(browserContentHash, nextDetails);
    } else if (contentHash) {
      contentHash = combinedContentHash(contentHash, nextDetails);
    }
  }

  return {
    httpStatus: response.status,
    conditionalValidatorsSent,
    contentHash: contentHash ? `${BASELINE_VERSION}${contentHash}` : null,
    browserContentHash: browserContentHash ? `${BASELINE_VERSION}${browserContentHash}` : null,
    detailHashesMatch,
    fetchedEtag,
    fetchedLastModified,
    detailPageHashes: JSON.stringify(nextDetails),
    partial,
    html: source.requiresBrowser ? browserHtml : html,
    detailSnapshots,
  };
}

export async function recoverAbandonedEventWatchScans(now = new Date()) {
  const staleBefore = new Date(now.getTime() - EVENT_WATCH_CLAIM_STALE_MS);
  const abandoned = await prisma.eventWatchScan.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: staleBefore } },
    data: {
      status: 'FAILED',
      outcome: 'INCOMPLETE',
      summary: 'Could not verify event details',
      finishedAt: now,
      error: 'Check was abandoned before it finished',
      historyQuality: 'DETAILED',
    },
  });
  await prisma.monitoredUrl.updateMany({
    where: { scanClaimedAt: { lt: staleBefore } },
    data: { scanClaimedAt: null, scanClaimToken: null },
  });
  return abandoned.count;
}

async function claimSourceRow(sourceId: string, now: Date, token: string) {
  const staleBefore = new Date(now.getTime() - EVENT_WATCH_CLAIM_STALE_MS);
  const claimed = await prisma.monitoredUrl.updateMany({
    where: {
      id: sourceId,
      OR: [{ scanClaimedAt: null }, { scanClaimedAt: { lt: staleBefore } }],
    },
    data: { scanClaimedAt: now, scanClaimToken: token },
  });
  return claimed.count === 1;
}

async function releaseClaim(sourceId: string, token: string) {
  await prisma.monitoredUrl.updateMany({
    where: { id: sourceId, scanClaimToken: token },
    data: { scanClaimedAt: null, scanClaimToken: null },
  });
}

async function queueCalendarSyncIfProduction() {
  if (isIsolatedDatabaseEnvironment()) return;
  await prisma.user.updateMany({
    where: { gcalSyncEnabled: true },
    data: { gcalSyncPending: true },
  });
}

async function createPendingEvent(event: ExtractedEvent, storageUrl: string | null, db: Pick<Prisma.TransactionClient, 'event'> = prisma) {
  const temporal = normalizeEventForWrite(
    fromCsvRow({
      start: event.start,
      end: event.end,
      timezone: event.timezone,
      temporal_kind: event.temporalKind,
    })
  );
  const stored = { ...event, url: storageUrl || undefined };
  const fingerprint = fingerprintFromNormalizedEvent(stored);
  const existing = await db.event.findFirst({ where: { dedupeFingerprint: fingerprint } });
  if (existing) return existing;
  return db.event.create({
    data: {
      title: event.title,
      description: event.description || null,
      url: storageUrl,
      location: event.location || null,
      ...temporalFieldsForPrisma(temporal),
      source: event.source || null,
      sponsoredBy: event.sponsoredBy || null,
      sponsorKind: event.sponsorKind || null,
      tags: event.tags?.length ? JSON.stringify(event.tags) : null,
      country: event.country || null,
      region: event.region || null,
      city: event.city || null,
      dedupeFingerprint: fingerprint,
      status: 'PENDING',
    },
  });
}

export async function runEventWatchSource(
  sourceId: string,
  options: { trigger?: CheckTrigger; deadlineAt?: number } = {}
) {
  const trigger = options.trigger ?? 'MANUAL';
  const now = new Date();
  const deadlineAt = options.deadlineAt ?? now.getTime() + EVENT_WATCH_CRON_BUDGET_MS;
  await recoverAbandonedEventWatchScans(now);
  const source = await prisma.monitoredUrl.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error('Monitored source not found');
  if (!source.enabled) throw new Error('Monitored source is disabled');
  if (trigger === 'SCHEDULED' && !isDueForScheduledCheck(sourceState(source), now)) {
    throw new Error('Source is not due for a scheduled check');
  }
  await assertSafePublicHttpUrl(source.url);

  const token = randomUUID();
  const claimPreview = claimSource(source, now, token);
  if (!claimPreview.claimed) throw new Error('A scan for this source is already running');
  const claimed = await claimSourceRow(source.id, now, token);
  if (!claimed) throw new Error('A scan for this source is already running');

  let scan: { id: string };
  try {
    scan = await prisma.eventWatchScan.create({
      data: { monitoredUrlId: source.id, trigger, status: 'RUNNING', outcome: 'RUNNING' },
    });
  } catch (error) {
    await releaseClaim(source.id, token);
    throw error;
  }

  try {
    const loaded = await withinTimeBudget(loadSourceContent(source, trigger === 'FORCE_FULL'),
      Math.min(90_000, deadlineAt - Date.now() - 15_000));
    const skip = decideExtractionSkip({
      forceFull: trigger === 'FORCE_FULL',
      now,
      lastFullScanAt: source.lastFullScanAt,
      fullVerificationIntervalMs: source.fullVerificationIntervalMs,
      processedContentHash: currentBaseline(source.processedContentHash),
      httpStatus: loaded.httpStatus,
      conditionalValidatorsSent: loaded.conditionalValidatorsSent,
      contentHash: source.requiresBrowser ? null : loaded.contentHash,
      requiresBrowser: source.requiresBrowser,
      browserContentHash: loaded.browserContentHash,
      monitorDetailPages: source.monitorDetailPages,
      detailHashesMatch: loaded.detailHashesMatch,
    });
    let extraction: { ok: true; events: ExtractedEvent[]; method: string } | { ok: false; error: string } | null =
      null;
    let extractionPartial = false;
    let verificationIssue: string | undefined;
    let extractionBaselineMatches = true;
    const shouldExtract =
      !skip.skip &&
      loaded.httpStatus != null &&
      loaded.httpStatus < 400 &&
      loaded.httpStatus !== 304 &&
      !loaded.partial;
    if (shouldExtract) {
      try {
        // Only extraction is raced: a timed-out task must never continue database writes.
        const extracted = await withinTimeBudget(
          extractCapturedSourceEvents(source, loaded.html, loaded.detailSnapshots),
          Math.min(120_000, deadlineAt - Date.now() - 15_000)
        );
        extractionPartial = extracted.partial;
        verificationIssue = extracted.issue;
        extractionBaselineMatches = extracted.baselineMatches;
        const normalized = await normalize_events({
          events: extracted.events,
          defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
        });
        if (normalized.events.length !== extracted.events.length) {
          extractionPartial = true;
          verificationIssue ||= 'Some extracted dates did not pass calendar validation';
        }
        extraction = { ok: true, events: normalized.events, method: extracted.method };
      } catch (error) {
        extraction = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const needsComparison = !loaded.partial && !extractionPartial && extraction?.ok && extraction.events.length > 0;
    const [identities, observations, proposals, candidates] = needsComparison ? await Promise.all([
      prisma.eventWatchIdentity.findMany({ where: { monitoredUrlId: source.id } }),
      prisma.eventWatchObservation.findMany({
        where: { monitoredUrlId: source.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.eventWatchChangeProposal.findMany({
        where: { monitoredUrlId: source.id },
        select: { eventId: true, signature: true, reviewStatus: true },
      }),
      prisma.eventWatchCandidate.findMany({
        where: { monitoredUrlId: source.id },
        select: { candidateKey: true, reviewStatus: true, pendingEventId: true },
      }),
    ]) : [[], [], [], []];

    const latestPayloadByKey: Record<string, ExtractedEvent> = {};
    const existingIdentityStarts: Array<{ stableKey: string; lastStart?: string | null }> = [];
    for (const observation of observations) {
      if (latestPayloadByKey[observation.stableKey]) continue;
      const payload = observation.payload as ExtractedEvent;
      latestPayloadByKey[observation.stableKey] = payload;
      existingIdentityStarts.push({ stableKey: observation.stableKey, lastStart: payload.start });
    }

    const linkedIds = identities.flatMap((identity) =>
      [identity.eventId, identity.pendingEventId].filter((id): id is string => Boolean(id))
    );
    const extractedEvents = extraction && extraction.ok ? extraction.events : [];
    const titles = [...new Set(extractedEvents.map((event) => event.title).filter(Boolean))];
    const urls = [...new Set(extractedEvents.map((event) => event.url).filter((url): url is string => Boolean(url)))];
    const calendarWhere = [
      linkedIds.length ? { id: { in: linkedIds } } : null,
      titles.length ? { title: { in: titles } } : null,
      urls.length ? { url: { in: urls } } : null,
    ].filter((entry): entry is { id: { in: string[] } } | { title: { in: string[] } } | { url: { in: string[] } } =>
      Boolean(entry)
    );
    const calendarEvents = calendarWhere.length
      ? await prisma.event.findMany({ where: { OR: calendarWhere } })
      : [];

    const built = buildCheckRecords({
      now,
      trigger,
      source: sourceState(source),
      httpStatus: loaded.httpStatus,
      conditionalValidatorsSent: loaded.conditionalValidatorsSent,
      contentHash: loaded.contentHash,
      browserContentHash: loaded.browserContentHash,
      detailHashesMatch: loaded.detailHashesMatch,
      fetchedEtag: loaded.fetchedEtag,
      fetchedLastModified: loaded.fetchedLastModified,
      extraction: shouldExtract ? extraction : loaded.httpStatus === 304 ? null : extraction,
      partial: loaded.partial || extractionPartial,
      verificationIssue: verificationIssue || (loaded.partial ? 'Could not verify all selected source pages' : undefined),
      calendarEvents: calendarEvents.map(calendarSnapshot),
      identities: identities.map((identity) => ({
        stableKey: identity.stableKey,
        identityKind: identity.identityKind,
        eventId: identity.eventId,
        pendingEventId: identity.pendingEventId,
        baselineEstablishedAt: identity.baselineEstablishedAt,
        ambiguous: identity.ambiguous,
      })),
      latestPayloadByKey,
      proposals,
      candidates,
      existingIdentityStarts,
    });

    const finishedAt = new Date();
    const baselines = new Map(identities.map((identity) => [identity.stableKey, identity.baselineEstablishedAt]));

    await prisma.$transaction(async (tx) => {
      const claim = await tx.monitoredUrl.findUnique({ where: { id: source.id }, select: { scanClaimToken: true } });
      if (claim?.scanClaimToken !== token) throw new Error('Source check no longer holds its claim');
      const pendingIds = new Map<string, string>();
      const publishedIds = new Map<string, string>();
      for (const pending of built.pendingEvents) {
        const created = await createPendingEvent(pending.event, pending.storageUrl, tx);
        if (created.status === 'PENDING') pendingIds.set(pending.stableKey, created.id);
        else publishedIds.set(pending.stableKey, created.id);
      }
      if (built.observations.length) {
        await tx.eventWatchObservation.createMany({
          data: built.observations.map((observation) => ({
            scanId: scan.id,
            monitoredUrlId: source.id,
            stableKey: observation.stableKey,
            contentFingerprint: observation.contentFingerprint,
            payload: asJson(observation.payload),
            sourceUrl: observation.sourceUrl,
            evidence: observation.evidence,
          })),
        });
      }
      for (const candidate of built.candidates) {
        if (publishedIds.has(candidate.stableKey)) continue;
        await tx.eventWatchCandidate.create({
          data: {
            monitoredUrlId: source.id,
            latestScanId: scan.id,
            pendingEventId: pendingIds.get(candidate.stableKey) || null,
            candidateKey: candidate.stableKey,
            matchStatus: candidate.matchStatus,
            reviewStatus: 'PENDING',
            candidatePayload: asJson(candidate.payload),
            sourceUrl: candidate.sourceUrl,
            evidence: candidate.evidence,
            historyQuality: 'DETAILED',
          },
        });
      }
      for (const link of built.identityLinks) {
        const publishedId = publishedIds.get(link.stableKey);
        const pendingEventId = publishedId
          ? null
          : link.attachPending
            ? pendingIds.get(link.stableKey) || null
            : undefined;
        const eventId = publishedId || link.eventId;
        const existingBaseline = baselines.get(link.stableKey) || null;
        const baselineEstablishedAt = link.establishBaseline ? existingBaseline || finishedAt : null;
        await tx.eventWatchIdentity.upsert({
          where: { monitoredUrlId_stableKey: { monitoredUrlId: source.id, stableKey: link.stableKey } },
          create: {
            monitoredUrlId: source.id,
            stableKey: link.stableKey,
            identityKind: link.identityKind,
            ambiguous: link.ambiguous,
            eventId,
            pendingEventId: pendingEventId || null,
            baselineEstablishedAt,
          },
          update: {
            identityKind: link.identityKind,
            ambiguous: link.ambiguous,
            eventId: eventId || undefined,
            pendingEventId,
            baselineEstablishedAt: link.establishBaseline ? existingBaseline || finishedAt : undefined,
          },
        });
      }
      if (built.proposals.length) {
        await tx.eventWatchChangeProposal.createMany({
          data: built.proposals.map((proposal) => ({
            monitoredUrlId: source.id,
            scanId: scan.id,
            eventId: proposal.eventId,
            stableKey: proposal.stableKey,
            kind: proposal.kind,
            previousValues: asJson(proposal.previousValues),
            proposedValues: asJson(proposal.proposedValues),
            changedFields: asJson(proposal.changedFields),
            sourceUrl: proposal.sourceUrl,
            evidence: proposal.evidence,
            signature: proposal.signature,
            eventUpdatedAtSnapshot: proposal.eventUpdatedAtSnapshot,
          })),
        });
      }
      await tx.eventWatchScan.update({
        where: { id: scan.id },
        data: {
          status: built.succeeded ? 'SUCCESS' : 'FAILED',
          outcome: built.outcome,
          extractionMethod: built.extractionMethod,
          finishedAt,
          eventsFound: built.eventsFound,
          newEvents: built.newEvents,
          matchedEvents: built.changedEvents + built.discrepancies,
          skippedEvents: built.unchangedEvents,
          changedEvents: built.changedEvents,
          unchangedEvents: built.unchangedEvents,
          baselinesEstablished: built.baselinesEstablished,
          discrepancyCount: built.discrepancies,
          fullExtractionRan: built.fullExtractionRan,
          skipReason: built.skipReason,
          summary: built.summary,
          error: built.error,
          httpStatus: loaded.httpStatus,
          contentHash: loaded.contentHash,
          historyQuality: 'DETAILED',
        },
      });

      const processedHash = source.requiresBrowser ? loaded.browserContentHash : loaded.contentHash;
      const advance = built.advanceProcessedBaseline && extractionBaselineMatches && Boolean(processedHash);
      const sameContent = Boolean(built.skipReason && processedHash && processedHash === source.processedContentHash);
      await tx.monitoredUrl.update({
        where: { id: source.id },
        data: {
          lastChecked: finishedAt,
          lastSuccess: built.succeeded ? finishedAt : source.lastSuccess,
          lastError: built.lastError,
          failureCount: built.failureCount,
          nextCheckAt: built.nextCheckAt,
          fetchedContentHash: loaded.contentHash || undefined,
          httpEtag: loaded.fetchedEtag || undefined,
          httpLastModified: loaded.fetchedLastModified || undefined,
          lastFetchedAt: loaded.httpStatus === 304 ? undefined : finishedAt,
          processedContentHash: advance ? processedHash : undefined,
          processedHttpEtag:
            advance || sameContent ? loaded.fetchedEtag || source.processedHttpEtag : undefined,
          processedHttpLastModified:
            advance || sameContent
              ? loaded.fetchedLastModified || source.processedHttpLastModified
              : undefined,
          lastFullScanAt: built.fullExtractionRan && built.succeeded ? finishedAt : undefined,
          // Detail hashes are part of the processed baseline, never advance on failure.
          detailPageHashes: advance || (built.succeeded && built.skipReason) ? loaded.detailPageHashes : undefined,
        },
      });
    });

    console.info(
      `[event-watch] source=${source.id} outcome=${built.outcome} fullExtraction=${built.fullExtractionRan} skip=${built.skipReason || 'none'}`
    );
    return {
      scanId: scan.id,
      ok: built.succeeded,
      summary: built.summary,
      outcome: built.outcome,
      newEvents: built.newEvents,
      changedEvents: built.changedEvents,
      discrepancies: built.discrepancies,
      unchangedEvents: built.unchangedEvents,
      fullExtractionRan: built.fullExtractionRan,
      skipReason: built.skipReason,
      manualAfterStop: Boolean(source.monitoringEndsAt && source.monitoringEndsAt < now),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCount = source.failureCount + 1;
    const finishedAt = new Date();
    await prisma.eventWatchScan.updateMany({
      where: { id: scan.id, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        outcome: 'FAILED',
        summary: 'Scan failed',
        finishedAt,
        error: message,
      },
    });
    await prisma.monitoredUrl.update({
      where: { id: source.id },
      data: {
        lastChecked: finishedAt,
        lastError: message,
        failureCount,
        nextCheckAt: nextCheckAtForSource(sourceState(source), finishedAt, failureCount, true),
      },
    });
    throw error;
  } finally {
    await releaseClaim(source.id, token);
  }
}

export async function runDueEventWatchSources(limit = EVENT_WATCH_CRON_SOURCE_LIMIT) {
  const started = Date.now();
  const now = new Date();
  await recoverAbandonedEventWatchScans(now);
  const sources = await prisma.monitoredUrl.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
        { OR: [{ monitoringEndsAt: null }, { monitoringEndsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ nextCheckAt: 'asc' }, { failureCount: 'asc' }],
    take: 50,
  });
  const ranked = sortDueSources(sources.filter((source) => isDueForScheduledCheck(sourceState(source), now)));
  const due = ranked.slice(0, Math.max(1, Math.min(limit, EVENT_WATCH_CRON_SOURCE_LIMIT)));
  const results = [];
  for (const source of due) {
    if (Date.now() - started > EVENT_WATCH_CRON_BUDGET_MS - 15_000) break;
    try {
      results.push({
        sourceId: source.id,
        ...(await runEventWatchSource(source.id, { trigger: 'SCHEDULED', deadlineAt: started + EVENT_WATCH_CRON_BUDGET_MS })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        sourceId: source.id,
        ok: message.includes('already running'),
        skipped: message.includes('already running'),
        error: message,
      });
    }
  }
  return {
    due: ranked.length,
    processed: results.length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

export async function withSchedulerRun<T extends { due: number; processed: number; failed: number }>(
  work: () => Promise<T>
) {
  const run = await prisma.eventWatchSchedulerRun.create({ data: { outcome: 'RUNNING' } });
  try {
    const result = await work();
    await prisma.eventWatchSchedulerRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        outcome: result.failed > 0 || result.processed < result.due ? 'PARTIAL' : 'SUCCESS',
        sourcesDue: result.due,
        processed: result.processed,
        failed: result.failed,
      },
    });
    return result;
  } catch (error) {
    await prisma.eventWatchSchedulerRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        outcome: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

function parseCandidatePayload(payload: Prisma.JsonValue): ExtractedEvent {
  const event = payload as Partial<ExtractedEvent>;
  if (!event.title || !event.start || !event.end) {
    throw new Error('Stored candidate is missing its required event fields');
  }
  return event as ExtractedEvent;
}

export async function approveEventWatchCandidate(candidateId: string, reviewerId: string) {
  const existing = await prisma.eventWatchCandidate.findUnique({ where: { id: candidateId } });
  if (!existing) throw new Error('Event Watch candidate not found');
  if (existing.matchStatus === 'AMBIGUOUS') throw new Error('Resolve this event match before publishing');
  if (existing.reviewStatus === 'APPROVED') {
    if (!existing.pendingEventId) throw new Error('Approved candidate has no event');
    const event = await prisma.event.findUnique({ where: { id: existing.pendingEventId } });
    if (!event) throw new Error('Approved event no longer exists');
    return event;
  }
  if (existing.reviewStatus !== 'PENDING') throw new Error('Candidate is no longer pending review');

  let pendingEventId = existing.pendingEventId;
  if (!pendingEventId) {
    const created = await createPendingEvent(parseCandidatePayload(existing.candidatePayload), null);
    pendingEventId = created.id;
  }
  const pending = await prisma.event.findUnique({ where: { id: pendingEventId } });
  if (!pending) throw new Error('Pending event could not be materialized');

  const event = await prisma.$transaction(async (tx) => {
    const marked = await tx.eventWatchCandidate.updateMany({
      where: { id: existing.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'APPROVED', reviewedAt: new Date(), reviewedBy: reviewerId, pendingEventId },
    });
    if (marked.count !== 1) {
      const latest = await tx.eventWatchCandidate.findUnique({ where: { id: existing.id } });
      if (latest?.reviewStatus === 'APPROVED' && latest.pendingEventId) {
        return tx.event.findUniqueOrThrow({ where: { id: latest.pendingEventId } });
      }
      throw new Error('Candidate is no longer pending review');
    }
    const published = await tx.event.update({ where: { id: pendingEventId }, data: { status: 'PUBLISHED' } });
    await tx.eventWatchIdentity.updateMany({
      where: { monitoredUrlId: existing.monitoredUrlId, stableKey: existing.candidateKey },
      data: { eventId: pendingEventId, pendingEventId },
    });
    return published;
  });
  await queueCalendarSyncIfProduction();
  if (!isIsolatedDatabaseEnvironment()) await processAllFilterSubscriptionsForEvent(event.id, event);
  return event;
}

export async function rejectEventWatchCandidate(candidateId: string, reviewerId: string) {
  const candidate = await prisma.eventWatchCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error('Event Watch candidate not found');
  if (candidate.reviewStatus === 'REJECTED') return;
  if (candidate.reviewStatus !== 'PENDING') throw new Error('Candidate is no longer pending review');
  await prisma.$transaction(async (tx) => {
    const rejected = await tx.eventWatchCandidate.updateMany({
      where: { id: candidate.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedBy: reviewerId },
    });
    if (!rejected.count) {
      const latest = await tx.eventWatchCandidate.findUnique({ where: { id: candidate.id } });
      if (latest?.reviewStatus === 'REJECTED') return;
      throw new Error('Candidate is no longer pending review');
    }
    if (candidate.pendingEventId) await tx.event.deleteMany({ where: { id: candidate.pendingEventId, status: 'PENDING' } });
  });
}

export async function reviewEventWatchProposal(
  proposalId: string,
  action: 'approve' | 'reject',
  reviewerId: string
) {
  const proposal = await prisma.eventWatchChangeProposal.findUnique({
    where: { id: proposalId },
    include: { event: true },
  });
  if (!proposal) throw new Error('Event Watch proposal not found');
  const decision = decideProposalReview({
    action,
    proposal: {
      reviewStatus: proposal.reviewStatus,
      proposedValues: proposal.proposedValues as Record<string, string | null>,
      changedFields: proposal.changedFields as string[],
      eventUpdatedAtSnapshot: proposal.eventUpdatedAtSnapshot,
    },
    event: calendarSnapshot(proposal.event),
  });
  if (decision.type === 'idempotent') return proposal.event;
  if (decision.type === 'invalid') throw new Error(decision.message);
  if (decision.type === 'rejected') {
    const rejected = await prisma.eventWatchChangeProposal.updateMany({
      where: { id: proposal.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedBy: reviewerId },
    });
    if (!rejected.count) {
      const latest = await prisma.eventWatchChangeProposal.findUnique({ where: { id: proposal.id } });
      if (latest?.reviewStatus !== 'REJECTED') throw new Error('Proposal is no longer pending review');
    }
    return proposal.event;
  }
  if (decision.type === 'conflict') {
    await prisma.eventWatchChangeProposal.updateMany({
      where: { id: proposal.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'STALE' },
    });
    throw new Error('This event changed after the proposal was created. Check the source again before reviewing.');
  }

  const conflictMessage = 'This event changed after the proposal was created. Check the source again before reviewing.';
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.event.findUnique({ where: { id: proposal.eventId } });
    if (!current) throw new Error('Event no longer exists');
    const fresh = decideProposalReview({
      action,
      proposal: {
        reviewStatus: proposal.reviewStatus,
        proposedValues: proposal.proposedValues as Record<string, string | null>,
        changedFields: proposal.changedFields as string[],
        eventUpdatedAtSnapshot: proposal.eventUpdatedAtSnapshot,
      },
      event: calendarSnapshot(current),
    });
    if (fresh.type === 'conflict') {
      throw new Error(conflictMessage);
    }
    if (fresh.type !== 'apply') throw new Error('Proposal is no longer pending review');
    const marked = await tx.eventWatchChangeProposal.updateMany({
      where: { id: proposal.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'APPROVED', reviewedAt: new Date(), reviewedBy: reviewerId },
    });
    if (marked.count === 0) {
      const latest = await tx.eventWatchChangeProposal.findUnique({ where: { id: proposal.id } });
      if (latest?.reviewStatus === 'APPROVED') return current;
      throw new Error('Proposal is no longer pending review');
    }
    // Compare-and-set closes the race between reading the event and writing it.
    const changed = await tx.event.updateMany({
      where: { id: current.id, updatedAt: proposal.eventUpdatedAtSnapshot },
      data: fresh.data as Prisma.EventUpdateManyMutationInput,
    });
    if (changed.count !== 1) throw new Error(conflictMessage);
    return tx.event.findUniqueOrThrow({ where: { id: current.id } });
  }).catch(async (error) => {
    // This must happen outside the rolled-back approval transaction.
    if (error instanceof Error && error.message === conflictMessage) {
      await prisma.eventWatchChangeProposal.updateMany({
        where: { id: proposal.id, reviewStatus: 'PENDING' }, data: { reviewStatus: 'STALE' },
      });
    }
    throw error;
  });
  await queueCalendarSyncIfProduction();
  return updated;
}
