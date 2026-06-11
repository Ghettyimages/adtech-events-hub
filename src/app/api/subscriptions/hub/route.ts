import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { Filter, getFilterDescription, getMatchingEvents } from '@/lib/filters';
import { resolveFilterHubContext } from '@/lib/hubs';
import { getHubGcalConnected, provisionAndSyncHub } from '@/lib/hubGcal';

const hubFilterSchema = z.object({
  filter: z.object({
    hubSlug: z.string().min(1),
    hostSlugs: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
  }),
  acceptTerms: z.boolean().optional(),
  checkOnly: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { filter, acceptTerms, checkOnly } = hubFilterSchema.parse(body);

    const hub = await prisma.eventHub.findUnique({
      where: { slug: filter.hubSlug },
    });
    if (!hub) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    }

    const hubEvents = await prisma.event.findMany({
      where: { hubId: hub.id, status: 'PUBLISHED' },
    });

    const context = await resolveFilterHubContext(filter);
    const matchingEvents = getMatchingEvents(hubEvents, filter as Filter, context);
    const filterStats = {
      matchCount: matchingEvents.length,
      totalCount: hubEvents.length,
      percentage:
        hubEvents.length > 0
          ? Math.round((matchingEvents.length / hubEvents.length) * 100)
          : 0,
    };

    if (checkOnly) {
      return NextResponse.json({
        stats: filterStats,
        filterDescription: getFilterDescription(filter as Filter),
      });
    }

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
      await prisma.user.update({
        where: { id: session.user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    const filterJson = JSON.stringify(filter);

    let subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'HUB',
        filter: filterJson,
      },
    });

    let isNewSubscription = false;

    if (subscription) {
      subscription = await prisma.subscription.update({
        where: { id: subscription.id },
        data: { active: true },
      });
    } else {
      subscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'HUB',
          active: true,
          filter: filterJson,
        },
      });
      isNewSubscription = true;
    }

    if (isNewSubscription) {
      const existingFollows = await prisma.eventFollow.findMany({
        where: { userId: session.user.id },
        select: { eventId: true },
      });
      const existingFollowIds = new Set(existingFollows.map((f) => f.eventId));
      const eventsToFollow = matchingEvents.filter((e) => !existingFollowIds.has(e.id));

      if (eventsToFollow.length > 0) {
        await prisma.eventFollow.createMany({
          data: eventsToFollow.map((event) => ({
            userId: session.user.id,
            eventId: event.id,
            subscriptionId: subscription!.id,
            source: 'FILTER',
          })),
          skipDuplicates: true,
        });

        for (const event of eventsToFollow) {
          await prisma.event.update({
            where: { id: event.id },
            data: { subscribers: { increment: 1 } },
          });
        }
      }
    }

    const userWithToken = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    let gcalSynced = false;
    let gcalSyncError: string | null = null;
    const gcalConnected = await getHubGcalConnected(session.user.id);

    if (gcalConnected) {
      try {
        const syncResult = await provisionAndSyncHub(session.user.id, hub.id);
        gcalSynced = syncResult.synced > 0;
        if (syncResult.errors.length > 0) {
          gcalSyncError = syncResult.errors[0];
        }
      } catch (error) {
        console.error('Hub subscription Google sync failed:', error);
        gcalSyncError = 'Failed to sync to Google Calendar';
      }
    }

    return NextResponse.json({
      subscription,
      feedToken: userWithToken?.feedToken || null,
      stats: filterStats,
      filterDescription: getFilterDescription(filter as Filter),
      message: `Hub subscription created. ${filterStats.matchCount} events matched.`,
      eventsAdded: filterStats.matchCount,
      gcalConnected,
      gcalSynced,
      gcalSyncError,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Error creating hub subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
