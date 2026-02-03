import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isAdmin: true },
    });

    if (!user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all subscription statistics in parallel
    const [
      fullCalendarSubscribers,
      googleCalendarConnected,
      customModeUsers,
      totalEventFollows,
      totalUsers,
    ] = await Promise.all([
      // Users with active FULL subscription
      prisma.subscription.count({
        where: { kind: 'FULL', active: true },
      }),
      // Users with Google Calendar connected (sync enabled)
      prisma.user.count({
        where: { gcalSyncEnabled: true },
      }),
      // Users in CUSTOM sync mode with Google Calendar connected
      prisma.user.count({
        where: { gcalSyncMode: 'CUSTOM', gcalSyncEnabled: true },
      }),
      // Total number of event follows
      prisma.eventFollow.count(),
      // Total registered users
      prisma.user.count(),
    ]);

    return NextResponse.json({
      fullCalendarSubscribers,
      googleCalendarConnected,
      customModeUsers,
      totalEventFollows,
      totalUsers,
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin stats' },
      { status: 500 }
    );
  }
}
