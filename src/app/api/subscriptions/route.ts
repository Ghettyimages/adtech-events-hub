import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all subscriptions and followed events
    const [subscriptions, eventFollows] = await Promise.all([
      prisma.subscription.findMany({
        where: { userId: session.user.id },
      }),
      prisma.eventFollow.findMany({
        where: { userId: session.user.id },
        include: {
          event: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    // Get user's feedToken
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    return NextResponse.json({
      subscriptions,
      eventFollows,
      feedToken: user?.feedToken || null,
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

