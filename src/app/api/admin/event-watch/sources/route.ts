import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { assertSafePublicHttpUrl } from '@/lib/safeRemoteUrl';
import { EVENT_WATCH_DEFAULT_INTERVAL_MS } from '@/lib/eventWatch';

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
});

export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;

  const sources = await prisma.monitoredUrl.findMany({
    orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    include: {
      scans: { orderBy: { startedAt: 'desc' }, take: 5 },
      _count: { select: { candidates: true, scans: true } },
    },
  });
  return NextResponse.json({ sources });
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
        nextCheckAt: new Date(),
      },
    });
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid source', details: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Failed to add source';
    const status = message.includes('Unique constraint') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
