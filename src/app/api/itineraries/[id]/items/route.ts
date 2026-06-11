import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  computeItineraryEvents,
  getItineraryForUser,
  previewItineraryAdd,
} from '@/lib/itinerary';
import {
  ITINERARY_ITEM_KIND,
  ITINERARY_LIMITS,
} from '@/lib/itineraryConstants';
import {
  syncItineraryEventsToGoogleCalendar,
  syncItineraryEventIfConnected,
} from '@/lib/itineraryGcal';
import { getGoogleTokensForUser } from '@/lib/hubGcal';

const itemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.EVENT),
    eventId: z.string(),
    confirmLargeAdd: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.HOST),
    hubHostId: z.string(),
    confirmLargeAdd: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.HUB),
    hubId: z.string(),
    confirmLargeAdd: z.boolean().optional(),
  }),
]);

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

    const body = await request.json();
    const input = itemSchema.parse(body);

    const refs =
      input.kind === ITINERARY_ITEM_KIND.EVENT
        ? { eventId: input.eventId }
        : input.kind === ITINERARY_ITEM_KIND.HOST
          ? { hubHostId: input.hubHostId }
          : { hubId: input.hubId };

    const preview = await previewItineraryAdd(itinerary.id, input.kind, refs);

    if (preview.exceedsCap) {
      return NextResponse.json(
        {
          error: 'ITINERARY_CAP',
          message: `This would exceed the ${ITINERARY_LIMITS.MAX_EVENTS} event limit`,
          preview,
        },
        { status: 400 }
      );
    }

    if (preview.requiresConfirm && !input.confirmLargeAdd) {
      return NextResponse.json(
        {
          error: 'CONFIRM_REQUIRED',
          message: `This will add ${preview.newEventCount} events. Confirm to continue.`,
          preview,
        },
        { status: 400 }
      );
    }

    if (input.kind === ITINERARY_ITEM_KIND.EVENT) {
      const dup = itinerary.items.find(
        (i) => i.kind === ITINERARY_ITEM_KIND.EVENT && i.eventId === input.eventId
      );
      if (dup) {
        return NextResponse.json(
          { error: 'Already in itinerary', item: dup },
          { status: 400 }
        );
      }
    } else if (input.kind === ITINERARY_ITEM_KIND.HOST) {
      const dup = itinerary.items.find(
        (i) =>
          i.kind === ITINERARY_ITEM_KIND.HOST && i.hubHostId === input.hubHostId
      );
      if (dup) {
        return NextResponse.json(
          { error: 'Host already in itinerary', item: dup },
          { status: 400 }
        );
      }
    } else {
      const dup = itinerary.items.find(
        (i) => i.kind === ITINERARY_ITEM_KIND.HUB && i.hubId === input.hubId
      );
      if (dup) {
        return NextResponse.json(
          { error: 'Hub already in itinerary', item: dup },
          { status: 400 }
        );
      }
    }

    const item = await prisma.itineraryItem.create({
      data: {
        itineraryId: itinerary.id,
        kind: input.kind,
        eventId:
          input.kind === ITINERARY_ITEM_KIND.EVENT ? input.eventId : undefined,
        hubHostId:
          input.kind === ITINERARY_ITEM_KIND.HOST ? input.hubHostId : undefined,
        hubId:
          input.kind === ITINERARY_ITEM_KIND.HUB ? input.hubId : undefined,
      },
    });

    let gcalSynced = 0;
    let syncing = false;

    if (itinerary.gcalSyncEnabled && itinerary.gcalCalendarId) {
      if (preview.newEventCount > ITINERARY_LIMITS.MAX_GCAL_UPSERTS_PER_REQUEST) {
        await prisma.itinerary.update({
          where: { id: itinerary.id },
          data: { gcalSyncPending: true },
        });
        syncing = true;
      } else if (input.kind === ITINERARY_ITEM_KIND.EVENT) {
        const event = await prisma.event.findUnique({
          where: { id: input.eventId },
        });
        if (event) {
          gcalSynced = (await syncItineraryEventIfConnected(
            session.user.id,
            itinerary.id,
            event
          ))
            ? 1
            : 0;
        }
      } else {
        const tokens = await getGoogleTokensForUser(session.user.id);
        if (tokens) {
          const result = await syncItineraryEventsToGoogleCalendar(
            session.user.id,
            itinerary.id,
            tokens,
            { maxInline: ITINERARY_LIMITS.MAX_GCAL_UPSERTS_PER_REQUEST }
          );
          gcalSynced = result.synced;
          syncing = result.pending;
        }
      }
    }

    const events = await computeItineraryEvents(itinerary.id);

    return NextResponse.json({
      item,
      preview,
      eventCount: events.length,
      gcalSynced: gcalSynced > 0,
      syncing,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error adding itinerary item:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
