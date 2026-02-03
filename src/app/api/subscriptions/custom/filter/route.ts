import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  Filter,
  getMatchingEvents,
  calculateFilterStats,
  getFilterDescription,
} from '@/lib/filters';

const filterSchema = z.object({
  filter: z.object({
    tags: z.array(z.string()).optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    source: z.string().optional(),
    dateRange: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
  }),
  acceptTerms: z.boolean().optional(),
  forceSubscribe: z.boolean().optional(), // Allow proceeding even with large filter
  checkOnly: z.boolean().optional(), // Just check stats, don't create subscription
});

const LARGE_FILTER_THRESHOLD = 50; // Percentage threshold to suggest FULL subscription

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { filter, acceptTerms, forceSubscribe, checkOnly } = filterSchema.parse(body);

    // Get all published events to calculate stats
    const allPublishedEvents = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
    });

    // Calculate filter statistics
    const filterStats = calculateFilterStats(allPublishedEvents, filter as Filter);
    const matchingEvents = getMatchingEvents(allPublishedEvents, filter as Filter);

    // If just checking stats, return them without creating subscription
    if (checkOnly) {
      return NextResponse.json({
        stats: filterStats,
        filterDescription: getFilterDescription(filter as Filter),
        suggestFullSubscription: filterStats.percentage >= LARGE_FILTER_THRESHOLD,
      });
    }

    // Check if filter matches too many events (>= 50%)
    if (filterStats.percentage >= LARGE_FILTER_THRESHOLD && !forceSubscribe) {
      return NextResponse.json({
        suggestFullSubscription: true,
        stats: filterStats,
        filterDescription: getFilterDescription(filter as Filter),
        message: `This filter matches ${filterStats.matchCount} events (${filterStats.percentage}% of all events). Consider subscribing to the Full Calendar instead, or narrow your filter criteria.`,
      });
    }

    // Check if user has accepted terms
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { termsAcceptedAt: true, feedToken: true },
    });

    if (!user?.termsAcceptedAt) {
      if (!acceptTerms) {
        return NextResponse.json(
          { error: 'Terms acceptance required', requiresTerms: true },
          { status: 400 }
        );
      }
      // Update user with terms acceptance
      await prisma.user.update({
        where: { id: session.user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    // Find or create CUSTOM subscription with filter
    const filterJson = JSON.stringify(filter);

    let subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'CUSTOM',
        filter: filterJson,
      },
    });

    let isNewSubscription = false;

    if (subscription) {
      // Update to ensure it's active
      subscription = await prisma.subscription.update({
        where: { id: subscription.id },
        data: { active: true },
      });
    } else {
      // Create new CUSTOM subscription with filter
      subscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'CUSTOM',
          active: true,
          filter: filterJson,
        },
      });
      isNewSubscription = true;
    }

    // Auto-follow all matching events (only for new subscriptions or reactivated ones)
    if (isNewSubscription || !subscription.active) {
      // Get existing follows for this user to avoid duplicates
      const existingFollows = await prisma.eventFollow.findMany({
        where: { userId: session.user.id },
        select: { eventId: true },
      });
      const existingFollowIds = new Set(existingFollows.map((f) => f.eventId));

      // Filter out events already followed
      const eventsToFollow = matchingEvents.filter(
        (event) => !existingFollowIds.has(event.id)
      );

      if (eventsToFollow.length > 0) {
        // Batch create EventFollow records
        await prisma.eventFollow.createMany({
          data: eventsToFollow.map((event) => ({
            userId: session.user.id,
            eventId: event.id,
            subscriptionId: subscription!.id,
            source: 'FILTER',
          })),
          skipDuplicates: true,
        });

        // Batch update subscriber counts
        await prisma.event.updateMany({
          where: {
            id: { in: eventsToFollow.map((e) => e.id) },
          },
          data: {
            subscribers: { increment: 1 },
          },
        });
      }
    }

    // Get updated user feedToken
    const userWithToken = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    return NextResponse.json({
      subscription,
      feedToken: userWithToken?.feedToken || null,
      stats: filterStats,
      filterDescription: getFilterDescription(filter as Filter),
      message: `Filter subscription created successfully. ${filterStats.matchCount} events matched and added to your calendar.`,
      eventsAdded: filterStats.matchCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error creating filter subscription:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
