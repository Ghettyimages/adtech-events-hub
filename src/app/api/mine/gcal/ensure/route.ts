import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { provisionAndClaimCalendar } from '@/lib/gcal';

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

    // Use the single-writer helper to provision and claim a calendar
    // This prevents race conditions that create duplicate calendars
    const result = await provisionAndClaimCalendar(
      session.user.id,
      googleAccount.access_token,
      googleAccount.refresh_token || undefined
    );

    // If this was a new calendar or newly claimed, set default sync mode
    if (result.action === 'created') {
      await prisma.user.update({
        where: { id: session.user.id },
        data: {
          gcalSyncPending: true,
          gcalSyncMode: 'FULL',
        },
      });
    }

    return NextResponse.json({
      success: true,
      calendarId: result.calendarId,
      action: result.action,
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

