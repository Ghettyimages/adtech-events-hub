import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');

    // Check full subscription
    const fullSubscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'FULL',
        active: true,
      },
    });

    let isFollowing = false;
    if (eventId) {
      // Check if following specific event
      const follow = await prisma.eventFollow.findUnique({
        where: {
          userId_eventId: {
            userId: session.user.id,
            eventId,
          },
        },
      });
      isFollowing = !!follow;
    }

    // Get user's feedToken
    const userWithToken = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    return NextResponse.json({
      fullSubscriptionActive: !!fullSubscription,
      isFollowing,
      feedToken: userWithToken?.feedToken || null,
    });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

