import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalize_events } from '@/lib/tools';
import {
  fingerprintFromNormalizedEvent,
  computeCandidateRowFingerprint,
} from '@/lib/dedupe';
import type { Event } from '@prisma/client';
import type { ExtractedEvent } from '@/lib/extractor/schema';

const ACTIONS = ['merge', 'replace', 'keep_both', 'dismiss'] as const;
type Action = (typeof ACTIONS)[number];

function dbEventToExtracted(ev: Event): ExtractedEvent {
  let tags: string[] | undefined;
  if (ev.tags) {
    try {
      const parsed = JSON.parse(ev.tags);
      tags = Array.isArray(parsed) ? parsed : undefined;
    } catch {
      tags = undefined;
    }
  }
  return {
    title: ev.title,
    start: ev.start.toISOString(),
    end: ev.end.toISOString(),
    location: ev.location || undefined,
    url: ev.url || undefined,
    description: ev.description || undefined,
    source: ev.source || undefined,
    timezone: ev.timezone || undefined,
    tags,
    city: ev.city || undefined,
    region: ev.region || undefined,
    country: ev.country || undefined,
    date_status: 'confirmed',
    location_status: 'confirmed',
  };
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body: {
    pendingEventId?: string;
    action?: string;
    mergedPayload?: Partial<ExtractedEvent>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { pendingEventId, action, mergedPayload } = body;
  if (!pendingEventId || !action || !ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { error: 'pendingEventId and action (merge|replace|keep_both|dismiss) required' },
      { status: 400 }
    );
  }

  const pending = await prisma.event.findUnique({ where: { id: pendingEventId } });
  if (!pending || pending.status !== 'PENDING') {
    return NextResponse.json({ error: 'Pending event not found' }, { status: 404 });
  }
  if (pending.duplicateReviewStatus !== 'PENDING_REVIEW' || !pending.potentialDuplicateOfId) {
    return NextResponse.json(
      { error: 'Event is not awaiting duplicate review' },
      { status: 400 }
    );
  }

  const existing = await prisma.event.findUnique({
    where: { id: pending.potentialDuplicateOfId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Matched event missing' }, { status: 404 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (action === 'dismiss') {
        const newFp = computeCandidateRowFingerprint({
          title: pending.title,
          start: pending.start.toISOString(),
          location: pending.location,
          url: pending.url,
          city: pending.city,
          region: pending.region,
          country: pending.country,
        });
        await tx.event.update({
          where: { id: pending.id },
          data: {
            potentialDuplicateOfId: null,
            duplicateReviewStatus: null,
            dedupeFingerprint: newFp,
          },
        });
        return;
      }

      if (action === 'keep_both') {
        const newFp = computeCandidateRowFingerprint({
          title: pending.title,
          start: pending.start.toISOString(),
          location: pending.location,
          url: pending.url,
          city: pending.city,
          region: pending.region,
          country: pending.country,
        });
        await tx.event.update({
          where: { id: pending.id },
          data: {
            potentialDuplicateOfId: null,
            duplicateReviewStatus: null,
            dedupeFingerprint: newFp,
          },
        });
        return;
      }

      if (action === 'replace') {
        const incoming = dbEventToExtracted(pending);
        const fp = fingerprintFromNormalizedEvent(incoming);
        await tx.event.update({
          where: { id: existing.id },
          data: {
            title: pending.title,
            description: pending.description,
            url: pending.url,
            location: pending.location,
            start: pending.start,
            end: pending.end,
            timezone: pending.timezone,
            source: pending.source,
            tags: pending.tags,
            country: pending.country,
            region: pending.region,
            city: pending.city,
            dedupeFingerprint: fp,
            updatedAt: new Date(),
          },
        });
        await tx.event.delete({ where: { id: pending.id } });
        return;
      }

      if (action === 'merge') {
        const base = dbEventToExtracted(existing);
        const incoming = dbEventToExtracted(pending);
        const overlay =
          mergedPayload && typeof mergedPayload === 'object'
            ? (mergedPayload as Partial<ExtractedEvent>)
            : {};
        const combined: ExtractedEvent = {
          ...base,
          ...incoming,
          ...overlay,
          date_status: 'confirmed',
          location_status: 'confirmed',
        };

        const norm = await normalize_events({ events: [combined] });
        if (!norm.ok || norm.events.length === 0) {
          throw new Error('Could not normalize merged event');
        }
        const e = norm.events[0];
        const fp = fingerprintFromNormalizedEvent(e);

        await tx.event.update({
          where: { id: existing.id },
          data: {
            title: e.title,
            description: e.description || null,
            url: e.url || null,
            location: e.location || null,
            start: new Date(e.start!),
            end: new Date(e.end!),
            timezone: e.timezone || null,
            source: e.source || null,
            tags: e.tags?.length ? JSON.stringify(e.tags) : null,
            country: e.country || null,
            region: e.region || null,
            city: e.city || null,
            dedupeFingerprint: fp,
            updatedAt: new Date(),
          },
        });
        await tx.event.delete({ where: { id: pending.id } });
      }
    });
  } catch (err: any) {
    const message = err?.message || 'Resolution failed';
    console.error('[duplicate-review]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
