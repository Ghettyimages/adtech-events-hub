import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { getItineraryForUser } from '@/lib/itinerary';
import {
  getItineraryGcalConnected,
  provisionAndSyncItinerary,
} from '@/lib/itineraryGcal';
import { ITINERARY_LIMITS } from '@/lib/itineraryConstants';

const schema = z.object({
  acceptTerms: z.boolean().optional(),
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
    const body = schema.parse(await request.json().catch(() => ({})));

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { termsAcceptedAt: true },
    });

    if (!user?.termsAcceptedAt) {
      if (!body.acceptTerms) {
        return NextResponse.json(
          { error: 'Terms acceptance required', requiresTerms: true },
          { status: 400 }
        );
      }
      await prisma.user.update({
        where: { id: session.user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    const itinerary = await getItineraryForUser(session.user.id, id);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const connectedCount = await prisma.itinerary.count({
      where: {
        userId: session.user.id,
        gcalSyncEnabled: true,
        gcalCalendarId: { not: null },
        id: { not: itinerary.id },
      },
    });
    if (!itinerary.gcalSyncEnabled && connectedCount >= ITINERARY_LIMITS.MAX_GCAL_CONNECTED) {
      return NextResponse.json(
        {
          error: 'GCAL_LIMIT',
          message: `You can sync at most ${ITINERARY_LIMITS.MAX_GCAL_CONNECTED} itineraries to Google Calendar`,
        },
        { status: 400 }
      );
    }

    const gcalConnected = await getItineraryGcalConnected(session.user.id);
    const syncResult = await provisionAndSyncItinerary(
      session.user.id,
      itinerary.id
    );

    return NextResponse.json({
      success: true,
      gcalConnected,
      gcalSynced: syncResult.synced > 0,
      syncing: syncResult.pending,
      stats: {
        synced: syncResult.synced,
        removed: syncResult.removed,
        errors: syncResult.errors,
      },
      message: gcalConnected
        ? syncResult.pending
          ? 'Subscribed. Syncing events in the background.'
          : `Synced ${syncResult.synced} timed event(s) to Google Calendar.`
        : 'Subscribed! Connect Google Calendar to sync events automatically.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error subscribing itinerary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
