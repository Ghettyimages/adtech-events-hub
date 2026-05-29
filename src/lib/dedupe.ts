/**
 * Event deduplication: URL/title normalization and fingerprinting
 */

import { createHash, randomUUID } from 'crypto';
import type { Event as DbEvent } from '@prisma/client';
import { prisma } from './db';
import type { ExtractedEvent } from './extractor/schema';
import { formatYmdUtc } from './eventTemporal';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  '_ga',
  'mc_eid',
  'igshid',
]);

export function normalizeEventUrl(url: string | undefined | null): string {
  if (!url || !String(url).trim()) return '';
  try {
    const u = new URL(String(url).trim());
    u.hash = '';
    const keysToDelete: string[] = [];
    u.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((k) => u.searchParams.delete(k));
    let path = u.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    u.pathname = path;
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return String(url).trim();
  }
}

export function normalizeTitleForDedupe(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}

export type DedupeParts = {
  title: string;
  start?: string | null;
  timezone?: string | null;
  location?: string | null;
  url?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

/**
 * Stable string used for hashing and for in-memory dedupe (must stay in sync).
 */
function dedupeStartKey(start?: string | null, timezone?: string | null): string {
  if (!start) return '';
  const d = new Date(start);
  if (isNaN(d.getTime())) return '';
  if (timezone == null || String(timezone).trim() === '') {
    return formatYmdUtc(d);
  }
  return d.toISOString();
}

export function dedupeBasisString(parts: DedupeParts): string {
  const title = normalizeTitleForDedupe(parts.title);
  const startIso = dedupeStartKey(parts.start, parts.timezone);
  let place = '';
  if (parts.city || parts.region || parts.country) {
    place = [parts.city, parts.region, parts.country]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase())
      .join('|');
  } else if (parts.location) {
    place = normalizeTitleForDedupe(parts.location);
  }
  const u = normalizeEventUrl(parts.url || '');
  return `${title}|${startIso}|${place}|${u}`;
}

export function computeDedupeFingerprint(parts: DedupeParts): string {
  return createHash('sha256').update(dedupeBasisString(parts), 'utf8').digest('hex');
}

/** Fingerprint for a pending row that might collide with an existing canonical fingerprint. */
export function computeCandidateRowFingerprint(parts: DedupeParts): string {
  return createHash('sha256')
    .update(`${dedupeBasisString(parts)}|candidate|${randomUUID()}`, 'utf8')
    .digest('hex');
}

export function fingerprintFromNormalizedEvent(event: ExtractedEvent): string {
  return computeDedupeFingerprint({
    title: event.title,
    start: event.start,
    timezone: event.timezone,
    location: event.location,
    url: event.url,
    city: event.city,
    region: event.region,
    country: event.country,
  });
}

export type MatchReason = 'fingerprint' | 'url' | 'legacy';

/**
 * Find an existing DB event that likely matches this normalized extract (for scrape ingestion).
 */
export async function findCandidateMatch(
  event: ExtractedEvent
): Promise<{ existing: DbEvent; reason: MatchReason } | null> {
  if (!event.start) return null;

  const fp = fingerprintFromNormalizedEvent(event);

  const byFp = await prisma.event.findFirst({
    where: { dedupeFingerprint: fp },
  });
  if (byFp) {
    return { existing: byFp, reason: 'fingerprint' };
  }

  const rawUrl = event.url?.trim();
  if (rawUrl) {
    const norm = normalizeEventUrl(rawUrl);
    const byExact = await prisma.event.findFirst({
      where: { OR: [{ url: rawUrl }, ...(norm && norm !== rawUrl ? [{ url: norm }] : [])] },
    });
    if (byExact) {
      return { existing: byExact, reason: 'url' };
    }
  }

  const legacy = await prisma.event.findFirst({
    where: {
      title: event.title,
      start: new Date(event.start),
      location: event.location || null,
    },
  });
  if (legacy) {
    return { existing: legacy, reason: 'legacy' };
  }

  return null;
}
