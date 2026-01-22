import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  upsertEventToGoogleCalendar,
  deleteEventFromGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
} from '@/lib/gcal';

const syncModeSchema = z.object({
  mode: z.enum(['FULL', 'CUSTOM']),
});

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { mode } = syncModeSchema.parse(body);

    // Get user's current state
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        gcalSyncMode: true,
        gcalSyncEnabled: true,
        gcalCalendarId: true,
        eventFollows: {
          include: { event: true },
        },
      },
    });

    if (!dbUser?.gcalSyncEnabled || !dbUser?.gcalCalendarId) {
      return NextResponse.json(
        { error: 'Google Calendar not connected' },
        { status: 400 }
      );
    }

    const previousMode = dbUser.gcalSyncMode || 'FULL';

    // Update sync mode
    await prisma.user.update({
      where: { id: session.user.id },
      data: { gcalSyncMode: mode },
    });

    // If switching to FULL, ensure FULL subscription is active
    if (mode === 'FULL') {
      let fullSubscription = await prisma.subscription.findFirst({
        where: {
          userId: session.user.id,
          kind: 'FULL',
        },
      });

      if (!fullSubscription) {
        await prisma.subscription.create({
          data: {
            userId: session.user.id,
            kind: 'FULL',
            active: true,
          },
        });
      } else if (!fullSubscription.active) {
        await prisma.subscription.update({
          where: { id: fullSubscription.id },
          data: { active: true },
        });
      }
    }

    // Get Google account for sync
    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: 'google',
      },
      select: { access_token: true, refresh_token: true },
    });

    if (!googleAccount?.access_token) {
      return NextResponse.json({
        success: true,
        message: `Sync mode updated to ${mode}. Please reconnect Google Calendar to sync.`,
        warning: 'No access token available',
      });
    }

    // Auto-trigger sync when mode changes
    const accessToken = googleAccount.access_token;
    const refreshToken = googleAccount.refresh_token || undefined;
    const calendarId = dbUser.gcalCalendarId;

    // Determine which events to sync based on new mode
    let eventsToSync: any[];
    if (mode === 'CUSTOM') {
      eventsToSync = dbUser.eventFollows
        .map((follow) => follow.event)
        .filter((event) => event.status === 'PUBLISHED');
    } else {
      eventsToSync = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
      });
    }

    const results = {
      synced: 0,
      removed: 0,
      errors: [] as string[],
    };

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

    // Cleanup orphaned events
    const currentSyncs = await prisma.userEventSync.findMany({
      where: {
        userId: session.user.id,
      },
    });

    for (const sync of currentSyncs) {
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
      message: `Sync mode updated to ${mode}. Synced ${results.synced} event(s)${
        results.removed > 0 ? `, removed ${results.removed} event(s)` : ''
      }`,
      previousMode,
      newMode: mode,
      synced: results.synced,
      removed: results.removed,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error updating sync mode:', error);
    return NextResponse.json(
      { error: 'Failed to update sync mode', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        gcalSyncMode: true,
        gcalSyncEnabled: true,
      },
    });

    return NextResponse.json({
      mode: dbUser?.gcalSyncMode || 'FULL',
      enabled: dbUser?.gcalSyncEnabled || false,
    });
  } catch (error: any) {
    console.error('Error getting sync mode:', error);
    return NextResponse.json(
      { error: 'Failed to get sync mode' },
      { status: 500 }
    );
  }
}

