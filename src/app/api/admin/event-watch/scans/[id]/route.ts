import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  const { id } = await params;
  const scan = await prisma.eventWatchScan.findUnique({
    where: { id },
    include: {
      observations: { orderBy: { createdAt: 'asc' } },
      proposals: { include: { event: true } },
      candidates: { include: { pendingEvent: true } },
      monitoredUrl: { select: { id: true, name: true, url: true } },
    },
  });
  if (!scan) return NextResponse.json({ error: 'Check not found' }, { status: 404 });
  const { contentHash: _contentHash, extractedPayload: _extractedPayload, ...visible } = scan;
  return NextResponse.json({
    scan: {
      ...visible,
      observations: scan.observations.map(({ contentFingerprint: _fingerprint, payload, ...observation }) => ({
        ...observation,
        payload: {
          title: (payload as { title?: string }).title,
          url: (payload as { url?: string }).url,
        },
      })),
    },
  });
}
