import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  upsertEventToGoogleCalendar,
  deleteEventFromGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
} from '@/lib/gcal';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

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

    // Get user's subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: {
        userId: session.user.id,
        active: true,
      },
    });

    const fullSubscription = subscriptions.find((s) => s.kind === 'FULL');
    const customSubscription = subscriptions.find((s) => s.kind === 'CUSTOM');

    if (!fullSubscription && !customSubscription) {
      return NextResponse.json(
        { error: 'No active subscriptions found' },
        { status: 400 }
      );
    }

    // Get events to sync
    let eventsToSync: any[] = [];
    let eventsToUnsync: any[] = [];

    if (fullSubscription) {
      // Sync all PUBLISHED events
      const allPublishedEvents = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
      });
      eventsToSync = allPublishedEvents;
    } else if (customSubscription) {
      // Sync only followed events
      const eventFollows = await prisma.eventFollow.findMany({
        where: { userId: session.user.id },
        include: { event: true },
      });
      eventsToSync = eventFollows.map((ef) => ef.event).filter((e) => e.status === 'PUBLISHED');
    }

    // Use primary calendar
    const calendarId = 'primary';
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

