import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  const candidates = await prisma.eventWatchCandidate.findMany({
    where: { reviewStatus: 'PENDING' },
    orderBy: { lastSeenAt: 'desc' },
    include: {
      monitoredUrl: true,
      pendingEvent: true,
      matchedEvent: true,
      latestScan: true,
    },
  });
  const counts = await prisma.eventWatchCandidate.groupBy({
    by: ['reviewStatus'],
    _count: { _all: true },
  });
  return NextResponse.json({ candidates, counts });
}
