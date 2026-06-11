import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  computeHubEventsToSync,
  getHubGcalConnected,
  hasActiveHubSubscription,
} from '@/lib/hubGcal';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hubSlug = searchParams.get('hubSlug');
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

    const hubSync = await prisma.hubCalendarSync.findUnique({
      where: { userId_hubId: { userId: session.user.id, hubId: hub.id } },
    });

    const gcalConnected = await getHubGcalConnected(session.user.id);
    const hubSubscriptionActive = await hasActiveHubSubscription(
      session.user.id,
      hubSlug
    );

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
      sync: hubSync
        ? {
            enabled: hubSync.gcalSyncEnabled,
            pending: hubSync.gcalSyncPending,
            calendarId: hubSync.gcalCalendarId,
            lastSyncedAt: hubSync.gcalLastSyncedAt,
            lastSyncError: hubSync.gcalLastSyncError,
          }
        : null,
      eventCount: eventsToSync.length,
      syncedEventIds,
      feedToken: user?.feedToken || null,
    });
  } catch (error) {
    console.error('Error fetching hub gcal status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
