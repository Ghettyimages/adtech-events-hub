import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ensureDedicatedCalendar, getCalendarClient } from '@/lib/gcal';

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
      select: { gcalCalendarId: true, gcalSyncEnabled: true, gcalSyncMode: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // If calendar ID exists in DB, verify it still exists in Google Calendar
    // If not, we'll need to find or create a new one
    let calendarId = dbUser.gcalCalendarId;
    
    if (calendarId) {
      // Verify the calendar still exists
      try {
        const calendar = getCalendarClient(
          googleAccount.access_token,
          googleAccount.refresh_token || undefined
        );
        await calendar.calendars.get({ calendarId });
        // Calendar exists, use it
        console.log('Verified existing calendar ID:', calendarId);
      } catch (verifyError: any) {
        // Calendar doesn't exist or is inaccessible, clear it and create new
        console.warn('Stored calendar ID is invalid, will create new calendar:', verifyError.message);
        calendarId = null;
      }
    }

    // Only ensure calendar if we don't have a valid one
    if (!calendarId) {
      calendarId = await ensureDedicatedCalendar(
        googleAccount.access_token,
        googleAccount.refresh_token || undefined
      );

      // Set default sync mode to FULL on initial calendar creation
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          gcalCalendarId: calendarId,
          gcalSyncEnabled: true,
          gcalSyncPending: true,
          gcalSyncMode: 'FULL',
        },
      });
    } else if (!dbUser.gcalSyncEnabled) {
      // Calendar exists but sync not enabled - enable it
      // Also ensure sync mode is set (default to FULL if not set)
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          gcalSyncEnabled: true,
          gcalSyncPending: true,
          gcalSyncMode: dbUser.gcalSyncMode || 'FULL',
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

