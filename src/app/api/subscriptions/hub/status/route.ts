import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  computeHubEventsToSync,
  getHubGcalConnected,
  hasActiveHubSubscription,
  isEventInHubSyncScope,
} from '@/lib/hubGcal';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hubSlug = searchParams.get('hubSlug');
    const eventId = searchParams.get('eventId');

    if (!hubSlug) {
      return NextResponse.json({ error: 'hubSlug required' }, { status: 400 });
    }

    const hub = await prisma.eventHub.findUnique({
      where: { slug: hubSlug },
      select: { id: true, name: true },
    });
    if (!hub) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    }

    const hubSubscriptionActive = await hasActiveHubSubscription(
      session.user.id,
      hubSlug
    );
    const gcalConnected = await getHubGcalConnected(session.user.id);

    const hubSync = await prisma.hubCalendarSync.findUnique({
      where: { userId_hubId: { userId: session.user.id, hubId: hub.id } },
    });

    let isFollowing = false;
    let eventInHubScope = false;

    if (eventId) {
      const follow = await prisma.eventFollow.findUnique({
        where: {
          userId_eventId: {
            userId: session.user.id,
            eventId,
          },
        },
      });
      isFollowing = !!follow;
      eventInHubScope = await isEventInHubSyncScope(
        session.user.id,
        hub.id,
        eventId
      );
    }

    const eventsToSync = await computeHubEventsToSync(session.user.id, hub.id);
    const syncedEventIds = hubSync?.gcalCalendarId
      ? (
          await prisma.userEventSync.findMany({
            where: {
              userId: session.user.id,
              gcalCalendarId: hubSync.gcalCalendarId,
              eventId: { in: eventsToSync.map((e) => e.id) },
            },
            select: { eventId: true },
          })
        ).map((s) => s.eventId)
      : [];

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    return NextResponse.json({
      hubSlug,
      hubName: hub.name,
      hubSubscriptionActive,
      gcalConnected,
      hubGcalProvisioned: !!hubSync?.gcalCalendarId,
      isFollowing,
      eventInHubScope,
      eventCount: eventsToSync.length,
      inScopeEventIds: eventsToSync.map((e) => e.id),
      syncedEventIds,
      feedToken: user?.feedToken || null,
      sync: hubSync
        ? {
            pending: hubSync.gcalSyncPending,
            lastSyncedAt: hubSync.gcalLastSyncedAt,
            lastSyncError: hubSync.gcalLastSyncError,
          }
        : null,
    });
  } catch (error) {
    console.error('Error checking hub subscription status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
