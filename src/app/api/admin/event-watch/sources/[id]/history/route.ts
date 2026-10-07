import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  const { id } = await params;
  const take = Math.min(Number(request.nextUrl.searchParams.get('take') || 10), 25);
  const cursor = request.nextUrl.searchParams.get('cursor');
  const scans = await prisma.eventWatchScan.findMany({
    where: { monitoredUrlId: id },
    orderBy: { startedAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      outcome: true,
      summary: true,
      startedAt: true,
      finishedAt: true,
      newEvents: true,
      changedEvents: true,
      error: true,
      historyQuality: true,
      fullExtractionRan: true,
      trigger: true,
    },
  });
  const nextCursor = scans.length > take ? scans[take - 1]?.id : null;
  return NextResponse.json({ scans: scans.slice(0, take), nextCursor });
}
