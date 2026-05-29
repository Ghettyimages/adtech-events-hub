import 'server-only';
import { prisma } from '@/lib/db';
import { resolveFilterHubContext } from '@/lib/hubs';
import {
  type EventLike,
  type Filter,
  type FilterMatchContext,
  eventMatchesFilter,
  getMatchingEvents,
  parseFilter,
} from '@/lib/filters';

export async function applyFilter<T extends EventLike>(
  events: T[],
  filter: Filter
): Promise<T[]> {
  const needsContext = Boolean(filter.hubSlug || (filter.hostSlugs && filter.hostSlugs.length > 0));
  if (!needsContext) {
    return getMatchingEvents(events, filter);
  }

  const context = await resolveFilterHubContext(filter);
  return getMatchingEvents(events, filter, context);
}

async function processSubscriptionsForEvent(
  eventId: string,
  event: EventLike,
  kinds: string[]
): Promise<number> {
  const filterSubscriptions = await prisma.subscription.findMany({
    where: {
      kind: { in: kinds },
      active: true,
      filter: { not: null },
    },
    select: {
      id: true,
      userId: true,
      filter: true,
    },
  });

  if (filterSubscriptions.length === 0) {
    return 0;
  }

  const existingFollows = await prisma.eventFollow.findMany({
    where: { eventId },
    select: { userId: true },
  });
  const existingFollowUserIds = new Set(existingFollows.map((f) => f.userId));

  const exclusions = await prisma.filterExclusion.findMany({
    where: { eventId },
    select: { userId: true, subscriptionId: true },
  });
  const exclusionMap = new Map<string, Set<string>>();
  exclusions.forEach((ex) => {
    if (!exclusionMap.has(ex.userId)) {
      exclusionMap.set(ex.userId, new Set());
    }
    exclusionMap.get(ex.userId)!.add(ex.subscriptionId);
  });

  const contextCache = new Map<string, FilterMatchContext>();
  const matchingSubscriptions: { subscriptionId: string; userId: string }[] = [];

  for (const subscription of filterSubscriptions) {
    if (existingFollowUserIds.has(subscription.userId)) {
      continue;
    }

    const userExclusions = exclusionMap.get(subscription.userId);
    if (userExclusions?.has(subscription.id)) {
      continue;
    }

    const filter = parseFilter(subscription.filter);
    if (!filter) continue;

    let context: FilterMatchContext | undefined;
    if (filter.hubSlug || (filter.hostSlugs && filter.hostSlugs.length > 0)) {
      const cacheKey = JSON.stringify({
        hubSlug: filter.hubSlug,
        hostSlugs: filter.hostSlugs,
      });
      if (!contextCache.has(cacheKey)) {
        contextCache.set(cacheKey, await resolveFilterHubContext(filter));
      }
      context = contextCache.get(cacheKey);
    }

    if (eventMatchesFilter(event, filter, context)) {
      matchingSubscriptions.push({
        subscriptionId: subscription.id,
        userId: subscription.userId,
      });
    }
  }

  if (matchingSubscriptions.length === 0) {
    return 0;
  }

  await prisma.eventFollow.createMany({
    data: matchingSubscriptions.map((sub) => ({
      userId: sub.userId,
      eventId,
      subscriptionId: sub.subscriptionId,
      source: 'FILTER',
    })),
    skipDuplicates: true,
  });

  await prisma.event.update({
    where: { id: eventId },
    data: {
      subscribers: { increment: matchingSubscriptions.length },
    },
  });

  return matchingSubscriptions.length;
}

export async function processFilterSubscriptionsForEvent(
  eventId: string,
  event: EventLike
): Promise<number> {
  return processSubscriptionsForEvent(eventId, event, ['CUSTOM']);
}

export async function processHubSubscriptionsForEvent(
  eventId: string,
  event: EventLike
): Promise<number> {
  return processSubscriptionsForEvent(eventId, event, ['HUB']);
}

export async function processAllFilterSubscriptionsForEvent(
  eventId: string,
  event: EventLike
): Promise<number> {
  const custom = await processFilterSubscriptionsForEvent(eventId, event);
  const hub = await processHubSubscriptionsForEvent(eventId, event);
  return custom + hub;
}
