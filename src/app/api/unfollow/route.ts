import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  deleteEventFromGoogleCalendar,
  generateEventICalUID,
} from '@/lib/gcal';

const unfollowSchema = z.object({
  eventId: z.string(),
  excludeFromFilter: z.boolean().optional(), // If true, create FilterExclusion to prevent re-follow
  confirmUnfollow: z.boolean().optional(), // Required for FILTER-sourced follows if not excluding
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { eventId, excludeFromFilter, confirmUnfollow } = unfollowSchema.parse(body);

    // Find the EventFollow
    const eventFollow = await prisma.eventFollow.findUnique({
      where: {
        userId_eventId: {
          userId: session.user.id,
          eventId,
        },
      },
      include: {
        subscription: {
          select: {
            id: true,
            filter: true,
          },
        },
      },
    });

    if (!eventFollow) {
      return NextResponse.json(
        { error: 'Not following this event' },
        { status: 404 }
      );
    }

    // Check if this is a FILTER-sourced follow
    const isFilterSourced = eventFollow.source === 'FILTER';
    const hasFilterSubscription = eventFollow.subscription?.filter !== null;

    // If it's a filter-sourced follow and no exclusion/confirm choice made, prompt the user
    if (isFilterSourced && hasFilterSubscription) {
      if (excludeFromFilter === undefined && confirmUnfollow !== true) {
        return NextResponse.json({
          requiresExclusionChoice: true,
          message: 'This event was added by a filter subscription. Would you like to exclude it permanently or allow it to be re-added later?',
          eventId,
          subscriptionId: eventFollow.subscriptionId,
        });
      }
    }

    // If user chose to exclude permanently, create FilterExclusion record
    if (excludeFromFilter === true && eventFollow.subscriptionId) {
      await prisma.filterExclusion.upsert({
        where: {
          userId_eventId_subscriptionId: {
            userId: session.user.id,
            eventId,
            subscriptionId: eventFollow.subscriptionId,
          },
        },
        create: {
          userId: session.user.id,
          eventId,
          subscriptionId: eventFollow.subscriptionId,
        },
        update: {}, // No update needed, just ensure it exists
      });
    }

    // Delete the EventFollow
    await prisma.eventFollow.delete({
      where: {
        id: eventFollow.id,
      },
    });

    // Decrement event subscriber counter
    await prisma.event.update({
      where: { id: eventId },
      data: {
        subscribers: {
          decrement: 1,
        },
      },
    });

    // Check if this event is synced to Google Calendar and remove it (for CUSTOM mode)
    let gcalRemoved = false;
    const userEventSync = await prisma.userEventSync.findUnique({
      where: {
        userId_eventId: {
          userId: session.user.id,
          eventId,
        },
      },
    });

    if (userEventSync) {
      // Get user's Google Calendar connection info
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          gcalCalendarId: true,
          gcalSyncMode: true,
        },
      });

      // Only remove from Google Calendar if in CUSTOM mode
      if (dbUser?.gcalCalendarId && dbUser?.gcalSyncMode === 'CUSTOM') {
        const googleAccount = await prisma.account.findFirst({
          where: {
            userId: session.user.id,
            provider: 'google',
          },
          select: { access_token: true, refresh_token: true },
        });

        if (googleAccount?.access_token) {
          try {
            const iCalUID = generateEventICalUID(eventId);
            await deleteEventFromGoogleCalendar(
              googleAccount.access_token,
              googleAccount.refresh_token || undefined,
              dbUser.gcalCalendarId,
              iCalUID
            );
            gcalRemoved = true;
          } catch (error) {
            console.error('Failed to delete event from Google Calendar:', error);
          }
        }
      }

      // Remove tracking record
      await prisma.userEventSync.delete({
        where: { id: userEventSync.id },
      });
    }

    return NextResponse.json({
      message: 'Event unfollowed successfully',
      gcalRemoved,
      excluded: excludeFromFilter === true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error unfollowing event:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
