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
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { eventId } = unfollowSchema.parse(body);

    // Find and delete EventFollow
    const eventFollow = await prisma.eventFollow.findUnique({
      where: {
        userId_eventId: {
          userId: session.user.id,
          eventId,
        },
      },
    });

    if (!eventFollow) {
      return NextResponse.json(
        { error: 'Not following this event' },
        { status: 404 }
      );
    }

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

