import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  upsertEventToGoogleCalendar,
  deleteEventFromGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
  provisionAndClaimCalendar,
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

    // Use single-writer helper to provision and claim calendar (prevents duplicates)
    const provisionResult = await provisionAndClaimCalendar(
      session.user.id,
      googleAccount.access_token,
      googleAccount.refresh_token || undefined
    );
    const calendarId = provisionResult.calendarId;

    // Get user's sync mode and followed events
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        gcalSyncMode: true,
        eventFollows: {
          include: { event: true },
        },
      },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const syncMode = dbUser.gcalSyncMode || 'FULL';

    // Determine which events to sync based on mode
    let eventsToSync: any[];
    if (syncMode === 'CUSTOM') {
      // Sync only followed events
      eventsToSync = dbUser.eventFollows
        .map((follow) => follow.event)
        .filter((event) => event.status === 'PUBLISHED');
    } else {
      // FULL mode: Ensure FULL subscription is active
      let fullSubscription = await prisma.subscription.findFirst({
        where: {
          userId: session.user.id,
          kind: 'FULL',
        },
      });

      if (!fullSubscription) {
        fullSubscription = await prisma.subscription.create({
          data: {
            userId: session.user.id,
            kind: 'FULL',
            active: true,
          },
        });
      } else if (!fullSubscription.active) {
        fullSubscription = await prisma.subscription.update({
          where: { id: fullSubscription.id },
          data: { active: true },
        });
      }

      // Get all published events
      eventsToSync = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
      });
    }

    const accessToken = googleAccount.access_token;
    const refreshToken = googleAccount.refresh_token || undefined;

    const results = {
      synced: 0,
      removed: 0,
      errors: [] as string[],
    };

    // Track event IDs we're syncing
    const syncedEventIds = new Set<string>();

    // Sync events
    for (const event of eventsToSync) {
      try {
        const gcalEvent = convertEventToGoogleCalendar(event);
        const gcalEventId = await upsertEventToGoogleCalendar(
          accessToken,
          refreshToken,
          calendarId,
          gcalEvent
        );

        // Track the sync in UserEventSync table
        await prisma.userEventSync.upsert({
          where: {
            userId_eventId: {
              userId: session.user.id,
              eventId: event.id,
            },
          },
          create: {
            userId: session.user.id,
            eventId: event.id,
            gcalEventId,
          },
          update: {
            gcalEventId,
            syncedAt: new Date(),
          },
        });

        syncedEventIds.add(event.id);
        results.synced++;
      } catch (error: any) {
        results.errors.push(`Failed to sync "${event.title}": ${error.message}`);
      }
    }

    // Cleanup orphaned events (events synced previously but no longer in current set)
    const currentSyncs = await prisma.userEventSync.findMany({
      where: {
        userId: session.user.id,
      },
    });

    for (const sync of currentSyncs) {
      // If this event wasn't in our current sync set, it's orphaned
      if (!syncedEventIds.has(sync.eventId)) {
        try {
          const iCalUID = generateEventICalUID(sync.eventId);
          await deleteEventFromGoogleCalendar(
            accessToken,
            refreshToken,
            calendarId,
            iCalUID
          );
          results.removed++;
        } catch (error: any) {
          console.error(`Failed to delete orphaned event ${sync.eventId}:`, error);
        }

        // Remove tracking record
        await prisma.userEventSync.delete({
          where: { id: sync.id },
        });
      }
    }

    // Update last sync timestamp
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        gcalLastSyncedAt: new Date(),
        gcalLastSyncError: results.errors.length > 0 ? results.errors.join('; ') : null,
        gcalLastSyncAttemptAt: new Date(),
        gcalSyncPending: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${results.synced} event(s) to Google Calendar${
        results.removed > 0 ? ` and removed ${results.removed} orphaned event(s)` : ''
      }`,
      synced: results.synced,
      removed: results.removed,
      mode: syncMode,
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
