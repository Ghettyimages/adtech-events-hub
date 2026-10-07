import { NextRequest, NextResponse } from 'next/server';
import type { MonitoredUrl } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { assertSafePublicHttpUrl } from '@/lib/safeRemoteUrl';
import { EVENT_WATCH_DEFAULT_INTERVAL_MS, sourceWatchStatus } from '@/lib/eventWatch';

const createSourceSchema = z.object({
  url: z.string().url(),
  name: z.string().trim().min(1).max(200),
  sourceType: z.string().trim().min(1).max(50).default('EVENT_CALENDAR'),
  authority: z.string().trim().min(1).max(50).default('OFFICIAL'),
  adapterType: z.string().trim().min(1).max(50).default('GENERIC'),
  region: z.string().trim().max(100).optional().nullable(),
  topics: z.array(z.string().trim().min(1).max(80)).max(25).default([]),
  checkInterval: z
    .number()
    .int()
    .min(60 * 60 * 1000)
    .max(30 * 24 * 60 * 60 * 1000)
    .default(EVENT_WATCH_DEFAULT_INTERVAL_MS),
  enabled: z.boolean().default(true),
  monitoringEndsAt: z.string().datetime().optional().nullable(),
  requiresBrowser: z.boolean().default(false),
  monitorDetailPages: z.boolean().default(false),
});

export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  const [sources, scheduler] = await Promise.all([
    prisma.monitoredUrl.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
      include: {
        scans: { orderBy: { startedAt: 'desc' }, take: 8 },
        _count: { select: { candidates: true, scans: true } },
      },
    }),
    prisma.eventWatchSchedulerRun.findFirst({ orderBy: { startedAt: 'desc' } }),
  ]);
  return NextResponse.json({
    sources: sources.map((source) => publicSource(source)),
    scheduler: scheduler
      ? {
          startedAt: scheduler.startedAt,
          finishedAt: scheduler.finishedAt,
          outcome: scheduler.outcome,
          sourcesDue: scheduler.sourcesDue,
          processed: scheduler.processed,
          failed: scheduler.failed,
        }
      : null,
  });
}

const SOURCE_PRIVATE_KEYS = [
  'httpEtag',
  'httpLastModified',
  'processedHttpEtag',
  'processedHttpLastModified',
  'fetchedContentHash',
  'processedContentHash',
  'detailPageHashes',
  'scanClaimToken',
  'scanClaimedAt',
] as const;

function publicSource(source: MonitoredUrl & { scans?: unknown; _count?: unknown }) {
  const visible: Record<string, unknown> = {
    ...source,
    watchStatus: sourceWatchStatus(source),
  };
  for (const key of SOURCE_PRIVATE_KEYS) delete visible[key];
  if (Array.isArray(source.scans)) {
    visible.scans = source.scans.map((scan) => {
      const row = scan as Record<string, unknown>;
      const { contentHash: _contentHash, extractedPayload: _extractedPayload, ...rest } = row;
      return rest;
    });
  }
  return visible;
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  try {
    const input = createSourceSchema.parse(await request.json());
    const safeUrl = await assertSafePublicHttpUrl(input.url);
    safeUrl.hash = '';
    const source = await prisma.monitoredUrl.create({
      data: {
        url: safeUrl.toString(),
        name: input.name,
        sourceType: input.sourceType,
        authority: input.authority,
        adapterType: input.adapterType,
        region: input.region || null,
        topics: input.topics.length ? JSON.stringify(input.topics) : null,
        checkInterval: input.checkInterval,
        enabled: input.enabled,
        monitoringEndsAt: input.monitoringEndsAt ? new Date(input.monitoringEndsAt) : null,
        requiresBrowser: input.requiresBrowser,
        monitorDetailPages: input.monitorDetailPages,
        nextCheckAt: new Date(),
      },
    });
    return NextResponse.json({ source: publicSource(source) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid source', details: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to add source';
    const status = message.includes('Unique constraint') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
