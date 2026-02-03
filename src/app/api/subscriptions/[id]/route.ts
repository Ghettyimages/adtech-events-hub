import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { getFilterDescription, parseFilter } from '@/lib/filters';

const deleteSchema = z.object({
  keepFollows: z.boolean().optional(), // If true, keep EventFollow records; if false, delete them
  confirmDelete: z.boolean().optional(), // Required to actually delete
});

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

    // Get the subscription
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        selections: {
          where: { source: 'FILTER' },
          include: {
            event: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        filterExclusions: true,
      },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Verify ownership
    if (subscription.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filter = parseFilter(subscription.filter);

    return NextResponse.json({
      subscription: {
        id: subscription.id,
        kind: subscription.kind,
        active: subscription.active,
        filter: filter,
        filterDescription: filter ? getFilterDescription(filter) : null,
        createdAt: subscription.createdAt,
      },
      followedEvents: subscription.selections.map((s) => ({
        id: s.event.id,
        title: s.event.title,
      })),
      followCount: subscription.selections.length,
      exclusionCount: subscription.filterExclusions.length,
    });
  } catch (error: any) {
    console.error('Error fetching subscription:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { keepFollows, confirmDelete } = deleteSchema.parse(body);

    // Get the subscription
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        selections: {
          where: { source: 'FILTER' },
          select: {
            id: true,
            eventId: true,
          },
        },
      },
    });

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Verify ownership
    if (subscription.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filterFollowCount = subscription.selections.length;

    // If this is a filter subscription with follows and no cleanup choice made, prompt the user
    if (subscription.filter && filterFollowCount > 0) {
      if (keepFollows === undefined && confirmDelete !== true) {
        return NextResponse.json({
          requiresCleanupChoice: true,
          message: `This filter subscription has ${filterFollowCount} events that were auto-followed. Would you like to keep them as individual follows or remove them?`,
          subscriptionId: id,
          followCount: filterFollowCount,
        });
      }
    }

    // If not keeping follows, delete the EventFollow records and decrement counters
    if (keepFollows === false && filterFollowCount > 0) {
      // Get event IDs for counter update
      const eventIds = subscription.selections.map((s) => s.eventId);

      // Delete all filter-sourced EventFollow records for this subscription
      await prisma.eventFollow.deleteMany({
        where: {
          subscriptionId: id,
          source: 'FILTER',
        },
      });

      // Decrement subscriber counts
      for (const eventId of eventIds) {
        await prisma.event.update({
          where: { id: eventId },
          data: {
            subscribers: { decrement: 1 },
          },
        });
      }
    } else if (keepFollows === true && filterFollowCount > 0) {
      // Convert filter follows to manual follows by clearing subscriptionId
      await prisma.eventFollow.updateMany({
        where: {
          subscriptionId: id,
          source: 'FILTER',
        },
        data: {
          subscriptionId: null,
          source: 'MANUAL', // Convert to manual follow
        },
      });
    }

    // Delete filter exclusions for this subscription
    await prisma.filterExclusion.deleteMany({
      where: { subscriptionId: id },
    });

    // Delete the subscription
    await prisma.subscription.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Subscription deleted successfully',
      followsKept: keepFollows === true,
      followsRemoved: keepFollows === false ? filterFollowCount : 0,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error deleting subscription:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
