import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDedicatedCalendar } from '@/lib/gcal';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's Google account
    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: 'google',
      },
    });

    if (!googleAccount || !googleAccount.access_token) {
      return NextResponse.json(
        { error: 'Google Calendar not connected. Please connect your Google account first.' },
        { status: 400 }
      );
    }

    // Get current user state
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { gcalCalendarId: true, gcalSyncEnabled: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Ensure calendar exists (idempotent)
    let calendarId = dbUser.gcalCalendarId;
    if (!calendarId) {
      calendarId = await ensureDedicatedCalendar(
        googleAccount.access_token,
        googleAccount.refresh_token || undefined
      );

      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          gcalCalendarId: calendarId,
          gcalSyncEnabled: true,
          gcalSyncPending: true,
        },
      });
    } else if (!dbUser.gcalSyncEnabled) {
      // Calendar exists but sync not enabled - enable it
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          gcalSyncEnabled: true,
          gcalSyncPending: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      calendarId,
      message: 'Calendar ensured and sync enabled',
    });
  } catch (error: any) {
    console.error('Error ensuring Google Calendar:', error);
    return NextResponse.json(
      { error: 'Failed to ensure Google Calendar', details: error.message },
      { status: 500 }
    );
  }
}

