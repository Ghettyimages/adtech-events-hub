import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  computeItineraryEventsToSync,
  getItineraryGcalConnected,
} from '@/lib/itineraryGcal';
import { getItineraryForUser } from '@/lib/itinerary';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const itineraryId = searchParams.get('itineraryId');
    if (!itineraryId) {
      return NextResponse.json({ error: 'itineraryId required' }, { status: 400 });
    }

    const itinerary = await getItineraryForUser(session.user.id, itineraryId);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const gcalConnected = await getItineraryGcalConnected(session.user.id);
    const eventsToSync = await computeItineraryEventsToSync(itinerary.id);

    const syncedEventIds = itinerary.gcalCalendarId
      ? (
          await prisma.userEventSync.findMany({
            where: {
              userId: session.user.id,
              gcalCalendarId: itinerary.gcalCalendarId,
              eventId: { in: eventsToSync.map((e) => e.id) },
            },
            select: { eventId: true },
          })
        ).map((s) => s.eventId)
      : [];

    return NextResponse.json({
      itineraryId: itinerary.id,
      itinerarySlug: itinerary.slug,
      itineraryName: itinerary.name,
      gcalConnected,
      gcalProvisioned: !!itinerary.gcalCalendarId,
      sync: {
        enabled: itinerary.gcalSyncEnabled,
        pending: itinerary.gcalSyncPending,
        calendarId: itinerary.gcalCalendarId,
        lastSyncedAt: itinerary.gcalLastSyncedAt?.toISOString() ?? null,
        lastSyncError: itinerary.gcalLastSyncError,
      },
      eventCount: eventsToSync.length,
      timedEventCount: eventsToSync.length,
      syncedEventIds,
    });
  } catch (error) {
    console.error('Error fetching itinerary gcal status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
