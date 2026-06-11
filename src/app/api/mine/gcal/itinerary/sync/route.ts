import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { getItineraryForUser } from '@/lib/itinerary';
import { syncItineraryEventsToGoogleCalendar } from '@/lib/itineraryGcal';

const schema = z.object({
  itineraryId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itineraryId } = schema.parse(await request.json());
    const itinerary = await getItineraryForUser(session.user.id, itineraryId);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const result = await syncItineraryEventsToGoogleCalendar(
      session.user.id,
      itinerary.id
    );

    return NextResponse.json({
      success: result.errors.length === 0,
      synced: result.synced,
      removed: result.removed,
      pending: result.pending,
      calendarId: result.calendarId,
      errors: result.errors,
      message:
        result.errors.length > 0
          ? result.errors.join('; ')
          : `Synced ${result.synced} event(s)`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error syncing itinerary Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to sync itinerary calendar' }, { status: 500 });
  }
}
