import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Derive subscriber count from:
    // 1. All users with active FULL subscription
    // 2. All users who explicitly follow this event
    // De-dupe by user ID

    const [fullSubscribers, explicitFollowers] = await Promise.all([
      // Get all users with active FULL subscription
      prisma.subscription.findMany({
        where: {
          kind: 'FULL',
          active: true,
        },
        select: {
          userId: true,
        },
      }),
      // Get all users who explicitly follow this event
      prisma.eventFollow.findMany({
        where: {
          eventId: id,
        },
        select: {
          userId: true,
        },
      }),
    ]);

    // Merge and dedupe by userId
    const subscriberUserIds = new Set<string>();
    fullSubscribers.forEach((sub) => subscriberUserIds.add(sub.userId));
    explicitFollowers.forEach((follow) => subscriberUserIds.add(follow.userId));

    return NextResponse.json({
      subscribers: subscriberUserIds.size,
    });
  } catch (error: any) {
    console.error('Error fetching event stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch event stats' },
      { status: 500 }
    );
  }
}

