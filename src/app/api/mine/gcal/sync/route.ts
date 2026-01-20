import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  upsertEventToGoogleCalendar,
  deleteEventFromGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
  ensureDedicatedCalendar,
} from '@/lib/gcal';

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

    // Ensure FULL subscription is active when Google Calendar is connected
    // This treats Google Calendar connection the same as subscribing to the full calendar
    let fullSubscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'FULL',
      },
    });

    if (!fullSubscription) {
      // Create FULL subscription (active by default)
      fullSubscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'FULL',
          active: true,
        },
      });
    } else if (!fullSubscription.active) {
      // Activate existing FULL subscription
      fullSubscription = await prisma.subscription.update({
        where: { id: fullSubscription.id },
        data: { active: true },
      });
    }

    // Get user's calendar ID (ensure it exists)
    let calendarId = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { gcalCalendarId: true },
    }).then((u) => u?.gcalCalendarId);

    if (!calendarId) {
      // Create dedicated calendar if it doesn't exist
      calendarId = await ensureDedicatedCalendar(
        googleAccount.access_token,
        googleAccount.refresh_token || undefined
      );
      await prisma.user.update({
        where: { id: session.user.id },
        data: { gcalCalendarId: calendarId },
      });
    }

    // Since we ensure FULL subscription is active, sync all PUBLISHED events
    const eventsToSync = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
    });

    const accessToken = googleAccount.access_token;
    const refreshToken = googleAccount.refresh_token || undefined;

    const results = {
      synced: 0,
      errors: [] as string[],
    };

    // Sync events
    for (const event of eventsToSync) {
      try {
        const gcalEvent = convertEventToGoogleCalendar(event);
        await upsertEventToGoogleCalendar(accessToken, refreshToken, calendarId, gcalEvent);
        results.synced++;
      } catch (error: any) {
        results.errors.push(`Failed to sync "${event.title}": ${error.message}`);
      }
    }

    // If custom subscription, we should delete events that are no longer followed
    // For now, we sync only followed events. To fully implement deletion:
    // 1. Track synced event IDs in a separate table
    // 2. Compare current follows with synced events
    // 3. Delete events from Google Calendar that are no longer followed
    // This is left as a future enhancement for simplicity

    // Update access token if it was refreshed
    // Note: In a production app, you'd want to update the token in the database
    // For now, NextAuth handles token refresh automatically

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${results.synced} event(s) to Google Calendar`,
      synced: results.synced,
      errors: results.errors,
    });
  } catch (error: any) {
    console.error('Error syncing to Google Calendar:', error);
    return NextResponse.json(
      { error: 'Failed to sync to Google Calendar', details: error.message },
      { status: 500 }
    );
  }
}

