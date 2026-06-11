import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { getItineraryForUser } from '@/lib/itinerary';
import {
  getGoogleTokensForUser,
  provisionAndClaimItineraryCalendar,
} from '@/lib/itineraryGcal';
import { ITINERARY_LIMITS } from '@/lib/itineraryConstants';

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

    const connectedCount = await prisma.itinerary.count({
      where: {
        userId: session.user.id,
        gcalSyncEnabled: true,
        gcalCalendarId: { not: null },
      },
    });
    if (!itinerary.gcalSyncEnabled && connectedCount >= ITINERARY_LIMITS.MAX_GCAL_CONNECTED) {
      return NextResponse.json(
        {
          error: 'GCAL_LIMIT',
          message: `You can sync at most ${ITINERARY_LIMITS.MAX_GCAL_CONNECTED} itineraries to Google Calendar`,
          max: ITINERARY_LIMITS.MAX_GCAL_CONNECTED,
        },
        { status: 400 }
      );
    }

    const tokens = await getGoogleTokensForUser(session.user.id);
    if (!tokens) {
      return NextResponse.json(
        { error: 'Google Calendar not connected. Please connect your Google account first.' },
        { status: 400 }
      );
    }

    const result = await provisionAndClaimItineraryCalendar(
      session.user.id,
      itinerary.id,
      tokens.accessToken,
      tokens.refreshToken
    );

    await prisma.itinerary.update({
      where: { id: itinerary.id },
      data: { gcalSyncPending: true },
    });

    return NextResponse.json({
      success: true,
      calendarId: result.calendarId,
      action: result.action,
      itineraryName: itinerary.name,
      message: `Itinerary calendar "${itinerary.name}" ready`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error ensuring itinerary Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to ensure itinerary calendar' }, { status: 500 });
  }
}
