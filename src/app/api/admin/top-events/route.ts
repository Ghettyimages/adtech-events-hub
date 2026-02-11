import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [fullSubscribers, events] = await Promise.all([
      prisma.subscription.count({
        where: { kind: 'FULL', active: true },
      }),
      prisma.event.findMany({
        where: { status: 'PUBLISHED' },
        select: {
          id: true,
          title: true,
          start: true,
          source: true,
          url: true,
          _count: {
            select: { follows: true },
          },
        },
        orderBy: {
          follows: {
            _count: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    const topEvents = events.map((event) => {
      const explicitFollows = event._count.follows;
      return {
        id: event.id,
        title: event.title,
        start: event.start,
        source: event.source,
        url: event.url,
        explicitFollows,
        totalReach: explicitFollows + fullSubscribers,
      };
    });

    return NextResponse.json({ topEvents });
  } catch (error) {
    console.error('Error fetching top events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top events' },
      { status: 500 },
    );
  }
}

