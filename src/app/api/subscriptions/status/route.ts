import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

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

    // Get user's feedToken and Google Calendar status
    const userWithToken = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true, gcalSyncEnabled: true, gcalCalendarId: true },
    });

    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: 'google',
      },
    });

    const gcalConnected =
      !!googleAccount &&
      !!userWithToken?.gcalSyncEnabled &&
      !!userWithToken?.gcalCalendarId;

    return NextResponse.json({
      fullSubscriptionActive: !!fullSubscription,
      isFollowing,
      feedToken: userWithToken?.feedToken || null,
      gcalConnected,
    });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

