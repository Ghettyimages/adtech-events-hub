import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return null;
  }
  return session;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') ?? 'all';

    const host = await prisma.hubHost.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!host) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const statusWhere: Prisma.EventWhereInput =
      statusFilter === 'published'
        ? { status: 'PUBLISHED' }
        : statusFilter === 'pending'
          ? { status: 'PENDING' }
          : { status: { in: ['PUBLISHED', 'PENDING'] } };

    const where: Prisma.EventWhereInput = {
      hubHostId: id,
      ...statusWhere,
    };

    const [events, published, pending] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { start: 'asc' },
      }),
      prisma.event.count({
        where: { hubHostId: id, status: 'PUBLISHED' },
      }),
      prisma.event.count({
        where: { hubHostId: id, status: 'PENDING' },
      }),
    ]);

    return NextResponse.json({
      events,
      counts: {
        published,
        pending,
        total: published + pending,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch host events' }, { status: 500 });
  }
}
