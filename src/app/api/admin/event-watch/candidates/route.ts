import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  const reviewStatus = request.nextUrl.searchParams.get('reviewStatus');
  const kind = request.nextUrl.searchParams.get('kind');
  const candidates = await prisma.eventWatchCandidate.findMany({
    where: {
      ...(reviewStatus === 'pending'
        ? { reviewStatus: { in: ['PENDING', 'STALE'] } }
        : reviewStatus && reviewStatus !== 'all'
          ? { reviewStatus: reviewStatus.toUpperCase() }
          : {}),
      ...(kind === 'new' ? { matchStatus: 'NEW_EVENT' } : {}),
      ...(kind === 'ambiguous' ? { matchStatus: 'AMBIGUOUS' } : {}),
      ...(kind === 'changed' ? { matchStatus: 'NONE' } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    include: {
      monitoredUrl: { select: { id: true, name: true, url: true } },
      pendingEvent: true,
      matchedEvent: true,
      latestScan: {
        select: {
          id: true,
          status: true,
          outcome: true,
          summary: true,
          startedAt: true,
          finishedAt: true,
          historyQuality: true,
        },
      },
    },
  });
  const proposals = await prisma.eventWatchChangeProposal.findMany({
    where: {
      ...(reviewStatus === 'pending'
        ? { reviewStatus: { in: ['PENDING', 'STALE'] } }
        : reviewStatus && reviewStatus !== 'all'
          ? { reviewStatus: reviewStatus.toUpperCase() }
          : {}),
      ...(kind === 'changed' ? { kind: 'SOURCE_CHANGE' } : {}),
      ...(kind === 'discrepancy' ? { kind: 'DISCREPANCY' } : {}),
      ...(kind === 'new' ? { id: 'none' } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      event: true,
      monitoredUrl: { select: { id: true, name: true, url: true } },
      scan: {
        select: {
          id: true,
          status: true,
          outcome: true,
          summary: true,
          startedAt: true,
          finishedAt: true,
          historyQuality: true,
        },
      },
    },
  });
  return NextResponse.json({ candidates, proposals });
}
