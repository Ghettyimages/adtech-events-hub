import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { getItineraryForUser } from '@/lib/itinerary';
import { getGoogleTokensForUser } from '@/lib/hubGcal';
import { syncItineraryEventsToGoogleCalendar } from '@/lib/itineraryGcal';

const schema = z.object({
  eventId: z.string(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const itinerary = await getItineraryForUser(session.user.id, id);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const { eventId } = schema.parse(await request.json());

    await prisma.itineraryExclusion.upsert({
      where: {
        itineraryId_eventId: { itineraryId: itinerary.id, eventId },
      },
      create: { itineraryId: itinerary.id, eventId },
      update: {},
    });

    if (itinerary.gcalSyncEnabled && itinerary.gcalCalendarId) {
      const tokens = await getGoogleTokensForUser(session.user.id);
      if (tokens) {
        await syncItineraryEventsToGoogleCalendar(
          session.user.id,
          itinerary.id,
          tokens
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error excluding itinerary event:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
