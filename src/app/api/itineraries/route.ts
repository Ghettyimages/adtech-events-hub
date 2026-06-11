import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  computeItineraryEvents,
  isItineraryGcalSyncableEvent,
  resolveUniqueItinerarySlug,
} from '@/lib/itinerary';
import { ITINERARY_LIMITS } from '@/lib/itineraryConstants';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  hubSlug: z.string().optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const itineraries = await prisma.itinerary.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        hub: { select: { slug: true, name: true, timezone: true } },
      },
    });

    const summaries = await Promise.all(
      itineraries.map(async (it) => {
        const events = await computeItineraryEvents(it.id);
        const timed = events.filter(isItineraryGcalSyncableEvent).length;
        return {
          id: it.id,
          name: it.name,
          slug: it.slug,
          optionalHubId: it.optionalHubId,
          hubSlug: it.hub?.slug ?? null,
          hubName: it.hub?.name ?? null,
          hubTimezone: it.hub?.timezone ?? null,
          eventCount: events.length,
          timedEventCount: timed,
          gcalSyncEnabled: it.gcalSyncEnabled,
          gcalSyncPending: it.gcalSyncPending,
          gcalLastSyncError: it.gcalLastSyncError,
          createdAt: it.createdAt.toISOString(),
          updatedAt: it.updatedAt.toISOString(),
        };
      })
    );

    return NextResponse.json({ itineraries: summaries });
  } catch (error) {
    console.error('Error listing itineraries:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, hubSlug } = createSchema.parse(body);

    const count = await prisma.itinerary.count({
      where: { userId: session.user.id },
    });
    if (count >= ITINERARY_LIMITS.MAX_PER_USER) {
      return NextResponse.json(
        {
          error: 'ITINERARY_LIMIT',
          message: `You can have at most ${ITINERARY_LIMITS.MAX_PER_USER} itineraries`,
          max: ITINERARY_LIMITS.MAX_PER_USER,
        },
        { status: 400 }
      );
    }

    let optionalHubId: string | undefined;
    if (hubSlug) {
      const hub = await prisma.eventHub.findUnique({
        where: { slug: hubSlug },
        select: { id: true },
      });
      if (!hub) {
        return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
      }
      optionalHubId = hub.id;
    }

    const slug = await resolveUniqueItinerarySlug(session.user.id, name);

    const itinerary = await prisma.itinerary.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        slug,
        optionalHubId,
      },
      include: {
        hub: { select: { slug: true, name: true, timezone: true } },
      },
    });

    return NextResponse.json({
      itinerary: {
        id: itinerary.id,
        name: itinerary.name,
        slug: itinerary.slug,
        optionalHubId: itinerary.optionalHubId,
        hubSlug: itinerary.hub?.slug ?? null,
        hubName: itinerary.hub?.name ?? null,
        hubTimezone: itinerary.hub?.timezone ?? null,
        eventCount: 0,
        timedEventCount: 0,
        gcalSyncEnabled: false,
        gcalSyncPending: false,
        gcalLastSyncError: null,
        createdAt: itinerary.createdAt.toISOString(),
        updatedAt: itinerary.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error creating itinerary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
