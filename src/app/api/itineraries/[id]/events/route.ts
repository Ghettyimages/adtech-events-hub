import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  computeItineraryEvents,
  getItineraryForUser,
  isItineraryGcalSyncableEvent,
  serializeItineraryEvent,
} from '@/lib/itinerary';
import { FESTIVAL_HUB_DEFAULT_ZONE } from '@/lib/eventTemporal';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const day = searchParams.get('day') ?? undefined;

    const itinerary = await getItineraryForUser(session.user.id, id);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const allEvents = await computeItineraryEvents(itinerary.id);
    const events = day
      ? await computeItineraryEvents(itinerary.id, { day })
      : allEvents;

    const displayTimezone =
      itinerary.hub?.timezone ?? FESTIVAL_HUB_DEFAULT_ZONE;

    return NextResponse.json({
      itineraryId: itinerary.id,
      displayTimezone,
      day: day ?? null,
      events: events.map(serializeItineraryEvent),
      stats: {
        total: allEvents.length,
        timed: allEvents.filter(isItineraryGcalSyncableEvent).length,
        allDay: allEvents.filter((e) => !isItineraryGcalSyncableEvent(e)).length,
      },
    });
  } catch (error) {
    console.error('Error fetching itinerary events:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
