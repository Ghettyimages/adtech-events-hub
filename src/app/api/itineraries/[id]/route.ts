import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  computeItineraryEvents,
  getItineraryForUser,
  isItineraryGcalSyncableEvent,
} from '@/lib/itinerary';
import { ITINERARY_ITEM_KIND } from '@/lib/itineraryConstants';

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

function itemLabel(item: {
  kind: string;
  event?: { title: string } | null;
  hubHost?: { name: string } | null;
  hub?: { name: string } | null;
}): string {
  if (item.kind === ITINERARY_ITEM_KIND.EVENT) {
    return item.event?.title ?? 'Event';
  }
  if (item.kind === ITINERARY_ITEM_KIND.HOST) {
    return item.hubHost?.name ?? 'Host';
  }
  return item.hub?.name ?? 'Hub';
}

export async function GET(
  _request: NextRequest,
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

    const events = await computeItineraryEvents(itinerary.id);
    const timed = events.filter(isItineraryGcalSyncableEvent);

    return NextResponse.json({
      itinerary: {
        id: itinerary.id,
        name: itinerary.name,
        slug: itinerary.slug,
        optionalHubId: itinerary.optionalHubId,
        hubSlug: itinerary.hub?.slug ?? null,
        hubName: itinerary.hub?.name ?? null,
        hubTimezone: itinerary.hub?.timezone ?? null,
        eventCount: events.length,
        timedEventCount: timed.length,
        gcalSyncEnabled: itinerary.gcalSyncEnabled,
        gcalSyncPending: itinerary.gcalSyncPending,
        gcalLastSyncError: itinerary.gcalLastSyncError,
        gcalCalendarId: itinerary.gcalCalendarId,
        createdAt: itinerary.createdAt.toISOString(),
        updatedAt: itinerary.updatedAt.toISOString(),
      },
      items: itinerary.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        eventId: item.eventId,
        hubHostId: item.hubHostId,
        hubId: item.hubId,
        label: itemLabel(item),
        createdAt: item.createdAt.toISOString(),
      })),
      exclusionCount: itinerary._count.exclusions,
    });
  } catch (error) {
    console.error('Error fetching itinerary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name } = updateSchema.parse(body);

    const existing = await getItineraryForUser(session.user.id, id);
    if (!existing) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const itinerary = await prisma.itinerary.update({
      where: { id: existing.id },
      data: name ? { name: name.trim() } : {},
    });

    return NextResponse.json({ itinerary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error updating itinerary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getItineraryForUser(session.user.id, id);
    if (!existing) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    await prisma.itinerary.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting itinerary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
