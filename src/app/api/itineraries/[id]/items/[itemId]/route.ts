import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getItineraryForUser } from '@/lib/itinerary';
import {
  getGoogleTokensForUser,
} from '@/lib/hubGcal';
import { syncItineraryEventsToGoogleCalendar } from '@/lib/itineraryGcal';

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, itemId } = await params;
    const itinerary = await getItineraryForUser(session.user.id, id);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const item = await prisma.itineraryItem.findFirst({
      where: { id: itemId, itineraryId: itinerary.id },
    });
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await prisma.itineraryItem.delete({ where: { id: itemId } });

    if (itinerary.gcalSyncEnabled && itinerary.gcalCalendarId) {
      const tokens = await getGoogleTokensForUser(session.user.id);
      if (tokens) {
        await syncItineraryEventsToGoogleCalendar(
          session.user.id,
          itinerary.id,
          tokens
        );
      } else {
        await prisma.itinerary.update({
          where: { id: itinerary.id },
          data: { gcalSyncPending: true },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing itinerary item:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
