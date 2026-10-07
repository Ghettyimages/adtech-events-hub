import 'server-only';

import { randomUUID } from 'crypto';
import type { Event, MonitoredUrl, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isIsolatedDatabaseEnvironment } from '@/lib/database-url';
import type { ExtractedEvent } from '@/lib/extractor/schema';
import { extractEventsFromUrl } from '@/lib/extractor/agent';
import { scrapeUrlGeneric } from '@/lib/scraper';
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
    processedContentHash: source.processedContentHash,
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

async function extractSourceEvents(source: MonitoredUrl): Promise<{
  events: ExtractedEvent[];
  method: ExtractionMethod;
}> {
  let agentEvents: ExtractedEvent[] = [];
  try {
    const result = await extractEventsFromUrl(source.url, source.name || new URL(source.url).hostname);
    agentEvents = result.events || [];
  } catch (error) {
    console.warn(`[event-watch] Agent extraction failed for ${source.url}`, error);
  }
  if (agentEvents.length > 0) return { events: agentEvents, method: 'agent' };

  const genericEvents = await scrapeUrlGeneric(source.url, source.name || undefined);
  if (genericEvents.length > 0) return { events: genericEvents, method: 'generic' };

  const firecrawl = await scrapeUrlWithFirecrawl(source.url);
  const overrideHtml =
    firecrawl.html || (firecrawl.markdown ? markdownToOverrideHtml(firecrawl.markdown) : undefined);
  if (overrideHtml) {
    const result = await extractEventsFromUrl(
      source.url,
      source.name || new URL(source.url).hostname,
      overrideHtml
    );
    if (result.events?.length) return { events: result.events, method: 'firecrawl-agent' };
  }

  if (firecrawl.error) throw new Error(firecrawl.error);
  return { events: [], method: 'generic' };
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

function parseDetailHashes(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function hashDetailPages(links: string[], stored: Record<string, string>) {
  const next = { ...stored };
  let detailHashesMatch = links.length > 0;
  let partial = false;
  await mapPool(links, 2, async (link) => {
    try {
      await assertSafePublicHttpUrl(link);
      const detail = await safePublicFetch(link);
      if (!detail.ok) {
        partial = true;
        detailHashesMatch = false;
        return;
      }
      const text = extractRelevantContent(await detail.text());
      const detailHash = hashContent(text);
      if (!stored[link] || stored[link] !== detailHash) detailHashesMatch = false;
      next[link] = detailHash;
    } catch (error) {
      console.warn(`[event-watch] Detail page check failed for ${link}`, error);
      partial = true;
      detailHashesMatch = false;
    }
  });
  return { next, detailHashesMatch, partial };
}

async function loadSourceContent(source: MonitoredUrl, forceFull: boolean) {
  const storedDetails = parseDetailHashes(source.detailPageHashes);
  // A static shell or validator is not evidence for a JavaScript agenda.
  const allowConditional = !forceFull && !source.requiresBrowser && Boolean(source.processedContentHash);
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

  const response = await safePublicFetch(source.url, { headers });
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
  const linkHtml = source.requiresBrowser ? browserHtml : html;
  if (source.monitorDetailPages && response.ok && linkHtml) {
    const links = extractDetailLinks(linkHtml, source.url, EVENT_WATCH_DETAIL_PAGE_LIMIT);
    const checked = await hashDetailPages(links, storedDetails);
    Object.assign(nextDetails, checked.next);
    detailHashesMatch = checked.detailHashesMatch;
    partial = checked.partial;
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
    contentHash,
    browserContentHash,
    detailHashesMatch,
    fetchedEtag,
    fetchedLastModified,
    detailPageHashes: JSON.stringify(nextDetails),
    partial,
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

async function createPendingEvent(event: ExtractedEvent, storageUrl: string | null) {
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
  const existing = await prisma.event.findFirst({ where: { dedupeFingerprint: fingerprint } });
  if (existing) return existing;
  return prisma.event.create({
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
  options: { trigger?: CheckTrigger } = {}
) {
  const trigger = options.trigger ?? 'MANUAL';
  const now = new Date();
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

  const scan = await prisma.eventWatchScan.create({
    data: { monitoredUrlId: source.id, trigger, status: 'RUNNING', outcome: 'RUNNING' },
  });

  try {
    const loaded = await loadSourceContent(source, trigger === 'FORCE_FULL');
    const skip = decideExtractionSkip({
      forceFull: trigger === 'FORCE_FULL',
      now,
      lastFullScanAt: source.lastFullScanAt,
      fullVerificationIntervalMs: source.fullVerificationIntervalMs,
      processedContentHash: source.processedContentHash,
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
    const shouldExtract =
      !skip.skip &&
      loaded.httpStatus != null &&
      loaded.httpStatus < 400 &&
      loaded.httpStatus !== 304 &&
      !loaded.partial;
    if (shouldExtract) {
      try {
        const extracted = await extractSourceEvents(source);
        const normalized = await normalize_events({
          events: extracted.events,
          defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
        });
        extraction = { ok: true, events: normalized.events, method: extracted.method };
      } catch (error) {
        extraction = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const [identities, observations, proposals, candidates] = await Promise.all([
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
    ]);

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
      partial: loaded.partial,
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

    const pendingIds = new Map<string, string>();
    const publishedIds = new Map<string, string>();
    for (const pending of built.pendingEvents) {
      const created = await createPendingEvent(pending.event, pending.storageUrl);
      if (created.status === 'PENDING') pendingIds.set(pending.stableKey, created.id);
      else publishedIds.set(pending.stableKey, created.id);
    }
    const finishedAt = new Date();
    const baselines = new Map(identities.map((identity) => [identity.stableKey, identity.baselineEstablishedAt]));

    await prisma.$transaction(async (tx) => {
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
      const advance = built.advanceProcessedBaseline && Boolean(processedHash);
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
          detailPageHashes: loaded.detailPageHashes,
        },
      });
    });

    console.info(
      `[event-watch] source=${source.id} outcome=${built.outcome} fullExtraction=${built.fullExtractionRan} skip=${built.skipReason || 'none'}`
    );
    return {
      scanId: scan.id,
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
    orderBy: [{ failureCount: 'asc' }, { nextCheckAt: 'asc' }],
    take: 50,
  });
  const ranked = sortDueSources(sources.filter((source) => isDueForScheduledCheck(sourceState(source), now)));
  const due = ranked.slice(0, Math.max(1, Math.min(limit, EVENT_WATCH_CRON_SOURCE_LIMIT)));
  const results = [];
  for (const source of due) {
    if (Date.now() - started > EVENT_WATCH_CRON_BUDGET_MS) break;
    try {
      results.push({
        sourceId: source.id,
        ok: true,
        ...(await runEventWatchSource(source.id, { trigger: 'SCHEDULED' })),
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
        outcome: result.failed > 0 ? 'PARTIAL' : 'SUCCESS',
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

  const [event] = await prisma.$transaction([
    prisma.event.update({
      where: { id: pendingEventId },
      data: { status: 'PUBLISHED' },
    }),
    prisma.eventWatchCandidate.update({
      where: { id: existing.id },
      data: { reviewStatus: 'APPROVED', reviewedAt: new Date(), reviewedBy: reviewerId, pendingEventId },
    }),
    prisma.eventWatchIdentity.updateMany({
      where: { monitoredUrlId: existing.monitoredUrlId, stableKey: existing.candidateKey },
      data: { eventId: pendingEventId, pendingEventId },
    }),
  ]);
  await queueCalendarSyncIfProduction();
  await processAllFilterSubscriptionsForEvent(event.id, event);
  return event;
}

export async function rejectEventWatchCandidate(candidateId: string, reviewerId: string) {
  const candidate = await prisma.eventWatchCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error('Event Watch candidate not found');
  if (candidate.reviewStatus === 'REJECTED') return;
  if (candidate.reviewStatus !== 'PENDING') throw new Error('Candidate is no longer pending review');
  await prisma.eventWatchCandidate.update({
    where: { id: candidate.id },
    data: { reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedBy: reviewerId },
  });
  if (candidate.pendingEventId) {
    await prisma.event.deleteMany({
      where: { id: candidate.pendingEventId, status: 'PENDING' },
    });
  }
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
    await prisma.eventWatchChangeProposal.updateMany({
      where: { id: proposal.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedBy: reviewerId },
    });
    return proposal.event;
  }
  if (decision.type === 'conflict') {
    await prisma.eventWatchChangeProposal.updateMany({
      where: { id: proposal.id, reviewStatus: 'PENDING' },
      data: { reviewStatus: 'STALE' },
    });
    throw new Error('This event changed after the proposal was created. Check the source again before reviewing.');
  }

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
      await tx.eventWatchChangeProposal.updateMany({
        where: { id: proposal.id, reviewStatus: 'PENDING' },
        data: { reviewStatus: 'STALE' },
      });
      throw new Error('This event changed after the proposal was created. Check the source again before reviewing.');
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
    return tx.event.update({
      where: { id: current.id },
      data: fresh.data as Prisma.EventUpdateInput,
    });
  });
  await queueCalendarSyncIfProduction();
  return updated;
}
