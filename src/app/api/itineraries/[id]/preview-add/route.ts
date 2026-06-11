import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { getItineraryForUser, previewItineraryAdd } from '@/lib/itinerary';
import { ITINERARY_ITEM_KIND } from '@/lib/itineraryConstants';

const previewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.EVENT),
    eventId: z.string(),
  }),
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.HOST),
    hubHostId: z.string(),
  }),
  z.object({
    kind: z.literal(ITINERARY_ITEM_KIND.HUB),
    hubId: z.string(),
  }),
]);

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
    const itinerary = await getItineraryForUser(session.user.id, id);
    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const eventId = searchParams.get('eventId') ?? undefined;
    const hubHostId = searchParams.get('hubHostId') ?? undefined;
    const hubId = searchParams.get('hubId') ?? undefined;

    const input = previewSchema.parse({ kind, eventId, hubHostId, hubId });
    const refs =
      input.kind === ITINERARY_ITEM_KIND.EVENT
        ? { eventId: input.eventId }
        : input.kind === ITINERARY_ITEM_KIND.HOST
          ? { hubHostId: input.hubHostId }
          : { hubId: input.hubId };

    const preview = await previewItineraryAdd(itinerary.id, input.kind, refs);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error previewing itinerary add:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
