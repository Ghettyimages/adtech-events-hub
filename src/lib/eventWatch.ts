import 'server-only';

import type { EventWatchCandidate, MonitoredUrl, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { ExtractedEvent } from '@/lib/extractor/schema';
import { extractEventsFromUrl } from '@/lib/extractor/agent';
import { scrapeUrlGeneric } from '@/lib/scraper';
import { markdownToOverrideHtml, scrapeUrlWithFirecrawl } from '@/lib/firecrawl';
import { fingerprintFromNormalizedEvent, findCandidateMatch } from '@/lib/dedupe';
import { normalize_events, ingestScrapedEvents } from '@/lib/tools';
import { assertSafePublicHttpUrl } from '@/lib/safeRemoteUrl';
import { processAllFilterSubscriptionsForEvent } from '@/lib/filters-server';

export const EVENT_WATCH_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURE_BACKOFF_MS = 7 * EVENT_WATCH_DEFAULT_INTERVAL_MS;

type ExtractionMethod = 'agent' | 'generic' | 'firecrawl-agent';

type ExtractionResult = {
  events: ExtractedEvent[];
  method: ExtractionMethod;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceEvidence(event: ExtractedEvent): string | null {
  return (
    [
      event.evidence,
      event.evidence_context,
      event.location_evidence,
      event.location_evidence_context,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join('\n\n') || null
  );
}

function evidenceConfidence(event: ExtractedEvent): number {
  let score = 0.55;
  if (event.date_status === 'confirmed' && event.evidence) score += 0.2;
  if (event.location_status === 'confirmed' && event.location_evidence) score += 0.15;
  if (event.url) score += 0.05;
  return Math.min(0.95, score);
}

async function extractSourceEvents(source: MonitoredUrl): Promise<ExtractionResult> {
  let agentEvents: ExtractedEvent[] = [];
  try {
    const result = await extractEventsFromUrl(
      source.url,
      source.name || new URL(source.url).hostname
    );
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

async function materializePendingEvent(event: ExtractedEvent): Promise<string> {
  const existing = await findCandidateMatch(event);
  if (existing?.existing.status === 'PENDING') return existing.existing.id;
  if (existing) {
    throw new Error(`Candidate now matches published event ${existing.existing.id}`);
  }
  const ingest = await ingestScrapedEvents([event], { publish: false });
  const fingerprint = fingerprintFromNormalizedEvent(event);
  const created = await prisma.event.findFirst({
    where: { dedupeFingerprint: fingerprint },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!created || ingest.errors > 0 || ingest.skipped > 0) {
    throw new Error(`Unable to create pending event for ${event.title}`);
  }
  return created.id;
}

function parseCandidatePayload(candidate: EventWatchCandidate): ExtractedEvent {
  const payload = candidate.candidatePayload as Partial<ExtractedEvent>;
  if (!payload.title || !payload.start || !payload.end) {
    throw new Error('Stored candidate is missing its required event fields');
  }
  return payload as ExtractedEvent;
}

export async function runEventWatchSource(sourceId: string) {
  const source = await prisma.monitoredUrl.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error('Monitored source not found');
  if (!source.enabled) throw new Error('Monitored source is disabled');
  await assertSafePublicHttpUrl(source.url);

  const activeScan = await prisma.eventWatchScan.findFirst({
    where: {
      monitoredUrlId: source.id,
      status: 'RUNNING',
      startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
  });
  if (activeScan) throw new Error('A scan for this source is already running');

  const scan = await prisma.eventWatchScan.create({
    data: { monitoredUrlId: source.id },
  });

  try {
    const extraction = await extractSourceEvents(source);
    const normalized = await normalize_events({
      events: extraction.events,
      defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
    });
    const now = new Date();
    const upcoming = normalized.events.filter((event) => {
      const end = new Date(event.end || event.start || '');
      return !Number.isNaN(end.getTime()) && end >= now;
    });

    let newEvents = 0;
    let matchedEvents = 0;
    let skippedEvents = normalized.events.length - upcoming.length;

    for (const event of upcoming) {
      const candidateKey = fingerprintFromNormalizedEvent(event);
      const existingObservation = await prisma.eventWatchCandidate.findUnique({
        where: { monitoredUrlId_candidateKey: { monitoredUrlId: source.id, candidateKey } },
      });
      if (existingObservation) {
        await prisma.eventWatchCandidate.update({
          where: { id: existingObservation.id },
          data: {
            latestScanId: scan.id,
            lastSeenAt: now,
            lastVerifiedAt: now,
            candidatePayload: asJson(event),
            evidence: sourceEvidence(event),
            confidence: evidenceConfidence(event),
          },
        });
        skippedEvents++;
        continue;
      }

      const match = await findCandidateMatch(event);
      if (match) {
        await prisma.eventWatchCandidate.create({
          data: {
            monitoredUrlId: source.id,
            latestScanId: scan.id,
            matchedEventId: match.existing.id,
            candidateKey,
            matchStatus: 'MATCHED_EVENT',
            matchReason: match.reason,
            reviewStatus: 'OBSERVED',
            candidatePayload: asJson(event),
            sourceUrl: source.url,
            evidence: sourceEvidence(event),
            confidence: evidenceConfidence(event),
          },
        });
        matchedEvents++;
        continue;
      }

      const candidate = await prisma.eventWatchCandidate.create({
        data: {
          monitoredUrlId: source.id,
          latestScanId: scan.id,
          candidateKey,
          matchStatus: 'NEW_EVENT',
          reviewStatus: 'PENDING',
          candidatePayload: asJson(event),
          sourceUrl: source.url,
          evidence: sourceEvidence(event),
          confidence: evidenceConfidence(event),
        },
      });
      const pendingEventId = await materializePendingEvent(event);
      await prisma.eventWatchCandidate.update({
        where: { id: candidate.id },
        data: { pendingEventId },
      });
      newEvents++;
    }

    const finishedAt = new Date();
    const scheduledNextCheck = new Date(finishedAt.getTime() + source.checkInterval);
    const nextCheckAt =
      source.monitoringEndsAt && scheduledNextCheck > source.monitoringEndsAt
        ? null
        : scheduledNextCheck;
    await prisma.$transaction([
      prisma.eventWatchScan.update({
        where: { id: scan.id },
        data: {
          status: 'SUCCESS',
          extractionMethod: extraction.method,
          finishedAt,
          eventsFound: normalized.events.length,
          newEvents,
          matchedEvents,
          skippedEvents,
          extractedPayload: asJson(normalized.events),
        },
      }),
      prisma.monitoredUrl.update({
        where: { id: source.id },
        data: {
          lastChecked: finishedAt,
          lastSuccess: finishedAt,
          lastError: null,
          failureCount: 0,
          nextCheckAt,
        },
      }),
    ]);
    return {
      scanId: scan.id,
      eventsFound: normalized.events.length,
      newEvents,
      matchedEvents,
      skippedEvents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    const failureCount = source.failureCount + 1;
    const backoff = Math.min(
      source.checkInterval * Math.pow(2, Math.min(failureCount, 6)),
      MAX_FAILURE_BACKOFF_MS
    );
    await prisma.$transaction([
      prisma.eventWatchScan.update({
        where: { id: scan.id },
        data: { status: 'FAILED', finishedAt, error: message },
      }),
      prisma.monitoredUrl.update({
        where: { id: source.id },
        data: {
          lastChecked: finishedAt,
          lastError: message,
          failureCount,
          nextCheckAt:
            source.monitoringEndsAt &&
            new Date(finishedAt.getTime() + backoff) > source.monitoringEndsAt
              ? null
              : new Date(finishedAt.getTime() + backoff),
        },
      }),
    ]);
    throw error;
  }
}

export async function runDueEventWatchSources(limit = 10) {
  const now = new Date();
  const sources = await prisma.monitoredUrl.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
        { OR: [{ monitoringEndsAt: null }, { monitoringEndsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ nextCheckAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 25)),
  });
  const results = [];
  for (const source of sources) {
    try {
      results.push({ sourceId: source.id, ok: true, ...(await runEventWatchSource(source.id)) });
    } catch (error) {
      results.push({
        sourceId: source.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function approveEventWatchCandidate(candidateId: string, reviewerId: string) {
  let candidate = await prisma.eventWatchCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error('Event Watch candidate not found');
  if (candidate.reviewStatus !== 'PENDING')
    throw new Error('Candidate is no longer pending review');

  let pendingEventId = candidate.pendingEventId;
  const pendingEvent = pendingEventId
    ? await prisma.event.findUnique({ where: { id: pendingEventId } })
    : null;
  if (!pendingEvent) {
    pendingEventId = await materializePendingEvent(parseCandidatePayload(candidate));
    candidate = await prisma.eventWatchCandidate.update({
      where: { id: candidate.id },
      data: { pendingEventId },
    });
  }
  if (!pendingEventId) throw new Error('Pending event could not be materialized');

  const [event] = await prisma.$transaction([
    prisma.event.update({ where: { id: pendingEventId }, data: { status: 'PUBLISHED' } }),
    prisma.eventWatchCandidate.update({
      where: { id: candidate.id },
      data: { reviewStatus: 'APPROVED', reviewedAt: new Date(), reviewedBy: reviewerId },
    }),
  ]);
  await prisma.user.updateMany({
    where: { gcalSyncEnabled: true },
    data: { gcalSyncPending: true },
  });
  await processAllFilterSubscriptionsForEvent(event.id, event);
  return event;
}

export async function rejectEventWatchCandidate(candidateId: string, reviewerId: string) {
  const candidate = await prisma.eventWatchCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error('Event Watch candidate not found');
  if (candidate.reviewStatus !== 'PENDING')
    throw new Error('Candidate is no longer pending review');

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
