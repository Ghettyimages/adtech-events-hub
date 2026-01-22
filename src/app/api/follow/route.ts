import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  upsertEventToGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
} from '@/lib/gcal';

const followSchema = z.object({
  eventId: z.string(),
  acceptTerms: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { eventId, acceptTerms } = followSchema.parse(body);

    // Check if user has accepted terms
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { termsAcceptedAt: true },
    });

    if (!user?.termsAcceptedAt) {
      if (!acceptTerms) {
        return NextResponse.json(
          { error: 'Terms acceptance required', requiresTerms: true },
          { status: 400 }
        );
      }
      // Update user with terms acceptance
      await prisma.user.update({
        where: { id: session.user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    // Verify event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Check if already following
    const existingFollow = await prisma.eventFollow.findUnique({
      where: {
        userId_eventId: {
          userId: session.user.id,
          eventId,
        },
      },
    });

    if (existingFollow) {
      return NextResponse.json(
        { error: 'Already following this event' },
        { status: 400 }
      );
    }

    // Ensure CUSTOM subscription exists
    let customSubscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'CUSTOM',
      },
    });

    if (!customSubscription) {
      customSubscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'CUSTOM',
          active: true,
        },
      });
    }

    // Create EventFollow
    const eventFollow = await prisma.eventFollow.create({
      data: {
        userId: session.user.id,
        eventId,
        subscriptionId: customSubscription.id,
      },
      include: {
        event: true,
      },
    });

    // Increment event subscriber counter
    await prisma.event.update({
      where: { id: eventId },
      data: {
        subscribers: {
          increment: 1,
        },
      },
    });

    // Auto-sync to Google Calendar if user is in CUSTOM mode
    let gcalSynced = false;
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        feedToken: true,
        gcalSyncEnabled: true,
        gcalSyncMode: true,
        gcalCalendarId: true,
      },
    });

    // Check if Google Calendar is connected and in CUSTOM mode
    if (
      dbUser?.gcalSyncEnabled &&
      dbUser?.gcalSyncMode === 'CUSTOM' &&
      dbUser?.gcalCalendarId &&
      event.status === 'PUBLISHED'
    ) {
      // Get Google account tokens
      const googleAccount = await prisma.account.findFirst({
        where: {
          userId: session.user.id,
          provider: 'google',
        },
        select: { access_token: true, refresh_token: true },
      });

      if (googleAccount?.access_token) {
        try {
          const gcalEvent = convertEventToGoogleCalendar(event);
          const gcalEventId = await upsertEventToGoogleCalendar(
            googleAccount.access_token,
            googleAccount.refresh_token || undefined,
            dbUser.gcalCalendarId,
            gcalEvent
          );

          // Track the sync in UserEventSync table
          await prisma.userEventSync.upsert({
            where: {
              userId_eventId: {
                userId: session.user.id,
                eventId,
              },
            },
            create: {
              userId: session.user.id,
              eventId,
              gcalEventId,
            },
            update: {
              gcalEventId,
              syncedAt: new Date(),
            },
          });

          gcalSynced = true;
        } catch (error) {
          // Log error but don't fail the follow operation
          console.error('Failed to sync event to Google Calendar:', error);
        }
      }
    }

    return NextResponse.json({
      eventFollow,
      feedToken: dbUser?.feedToken || null,
      message: 'Event followed successfully',
      gcalSynced,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error following event:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

