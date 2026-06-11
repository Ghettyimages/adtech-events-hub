import 'server-only';
import type { Event, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { TEMPORAL_KIND, FESTIVAL_HUB_DEFAULT_ZONE } from '@/lib/eventTemporal';
import {
  ITINERARY_ITEM_KIND,
  ITINERARY_LIMITS,
  type ItineraryItemKind,
} from '@/lib/itineraryConstants';

export function slugifyItineraryName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Festival hub events sync to GCal only when TIMED. */
export function isItineraryGcalSyncableEvent(
  event: Pick<Event, 'temporalKind' | 'hubId'>
): boolean {
  if (!event.hubId) return true;
  return event.temporalKind === TEMPORAL_KIND.TIMED;
}

export function isHubGcalSyncableEvent(
  event: Pick<Event, 'temporalKind' | 'hubId'>
): boolean {
  return isItineraryGcalSyncableEvent(event);
}

type EventWithHost = Event & {
  hubHost?: { name: string; slug: string } | null;
};

export async function getItineraryForUser(
  userId: string,
  itineraryIdOrSlug: string
) {
  const byId = await prisma.itinerary.findFirst({
    where: { id: itineraryIdOrSlug, userId },
    include: {
      hub: { select: { id: true, slug: true, name: true, timezone: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          event: { select: { id: true, title: true } },
          hubHost: { select: { id: true, name: true, slug: true } },
          hub: { select: { id: true, name: true, slug: true } },
        },
      },
      _count: { select: { exclusions: true } },
    },
  });
  if (byId) return byId;

  return prisma.itinerary.findFirst({
    where: { slug: itineraryIdOrSlug, userId },
    include: {
      hub: { select: { id: true, slug: true, name: true, timezone: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          event: { select: { id: true, title: true } },
          hubHost: { select: { id: true, name: true, slug: true } },
          hub: { select: { id: true, name: true, slug: true } },
        },
      },
      _count: { select: { exclusions: true } },
    },
  });
}

export async function resolveUniqueItinerarySlug(
  userId: string,
  name: string
): Promise<string> {
  const base = slugifyItineraryName(name) || 'itinerary';
  let slug = base;
  let n = 2;
  while (
    await prisma.itinerary.findUnique({
      where: { userId_slug: { userId, slug } },
      select: { id: true },
    })
  ) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

async function loadItineraryContext(itineraryId: string) {
  const [items, exclusions] = await Promise.all([
    prisma.itineraryItem.findMany({ where: { itineraryId } }),
    prisma.itineraryExclusion.findMany({
      where: { itineraryId },
      select: { eventId: true },
    }),
  ]);
  return {
    items,
    excludedIds: new Set(exclusions.map((e) => e.eventId)),
  };
}

async function eventsForItem(
  item: Prisma.ItineraryItemGetPayload<object>
): Promise<Event[]> {
  if (item.kind === ITINERARY_ITEM_KIND.EVENT && item.eventId) {
    const event = await prisma.event.findFirst({
      where: { id: item.eventId, status: 'PUBLISHED' },
    });
    return event ? [event] : [];
  }
  if (item.kind === ITINERARY_ITEM_KIND.HOST && item.hubHostId) {
    return prisma.event.findMany({
      where: { hubHostId: item.hubHostId, status: 'PUBLISHED' },
    });
  }
  if (item.kind === ITINERARY_ITEM_KIND.HUB && item.hubId) {
    return prisma.event.findMany({
      where: { hubId: item.hubId, status: 'PUBLISHED' },
    });
  }
  return [];
}

export async function computeItineraryEvents(
  itineraryId: string,
  options?: { day?: string; syncableOnly?: boolean }
): Promise<EventWithHost[]> {
  const { items, excludedIds } = await loadItineraryContext(itineraryId);
  const eventIdSet = new Set<string>();
  const result: EventWithHost[] = [];

  for (const item of items) {
    const events = await eventsForItem(item);
    for (const event of events) {
      if (excludedIds.has(event.id) || eventIdSet.has(event.id)) continue;
      if (options?.syncableOnly && !isItineraryGcalSyncableEvent(event)) continue;
      eventIdSet.add(event.id);
      result.push(event);
    }
  }

  const withHosts = await prisma.event.findMany({
    where: { id: { in: result.map((e) => e.id) } },
    include: {
      hubHost: { select: { name: true, slug: true } },
    },
  });
  const hostMap = new Map(withHosts.map((e) => [e.id, e]));

  let merged = result
    .map((e) => hostMap.get(e.id) ?? e)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (options?.day) {
    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
      include: { hub: { select: { timezone: true } } },
    });
    const zone =
      itinerary?.hub?.timezone || FESTIVAL_HUB_DEFAULT_ZONE;
    const { civilDayKeyInZone, resolveEventTimezone } = await import(
      '@/lib/eventTemporal'
    );
    merged = merged.filter((event) => {
      const eventZone = resolveEventTimezone(event, zone);
      const dayKey = civilDayKeyInZone(new Date(event.start), eventZone);
      return dayKey === options.day;
    });
  }

  return merged;
}

export async function countEventsForAdd(
  kind: ItineraryItemKind,
  refs: { eventId?: string; hubHostId?: string; hubId?: string }
): Promise<{ total: number; timed: number; allDayExcluded: number }> {
  let events: Event[] = [];
  if (kind === ITINERARY_ITEM_KIND.EVENT && refs.eventId) {
    const event = await prisma.event.findFirst({
      where: { id: refs.eventId, status: 'PUBLISHED' },
    });
    events = event ? [event] : [];
  } else if (kind === ITINERARY_ITEM_KIND.HOST && refs.hubHostId) {
    events = await prisma.event.findMany({
      where: { hubHostId: refs.hubHostId, status: 'PUBLISHED' },
    });
  } else if (kind === ITINERARY_ITEM_KIND.HUB && refs.hubId) {
    events = await prisma.event.findMany({
      where: { hubId: refs.hubId, status: 'PUBLISHED' },
    });
  }

  const timed = events.filter(isItineraryGcalSyncableEvent).length;
  return {
    total: events.length,
    timed,
    allDayExcluded: events.length - timed,
  };
}

export async function previewItineraryAdd(
  itineraryId: string,
  kind: ItineraryItemKind,
  refs: { eventId?: string; hubHostId?: string; hubId?: string }
) {
  const current = await computeItineraryEvents(itineraryId);
  const currentIds = new Set(current.map((e) => e.id));

  const addCounts = await countEventsForAdd(kind, refs);
  let newEventCount = 0;
  if (kind === ITINERARY_ITEM_KIND.EVENT && refs.eventId) {
    newEventCount = currentIds.has(refs.eventId) ? 0 : addCounts.total > 0 ? 1 : 0;
  } else {
    const events = await eventsForItem({
      id: '',
      itineraryId,
      kind,
      eventId: refs.eventId ?? null,
      hubHostId: refs.hubHostId ?? null,
      hubId: refs.hubId ?? null,
      createdAt: new Date(),
    });
    newEventCount = events.filter((e) => !currentIds.has(e.id)).length;
  }

  const totalAfter = current.length + newEventCount;

  return {
    kind,
    newEventCount,
    newTimedEventCount: addCounts.timed,
    allDayExcludedCount: addCounts.allDayExcluded,
    totalAfter,
    exceedsCap: totalAfter > ITINERARY_LIMITS.MAX_EVENTS,
    requiresConfirm: newEventCount >= ITINERARY_LIMITS.PREVIEW_CONFIRM_THRESHOLD,
    maxEvents: ITINERARY_LIMITS.MAX_EVENTS,
  };
}

export async function isEventInItineraryScope(
  userId: string,
  itineraryId: string,
  eventId: string
): Promise<boolean> {
  const itinerary = await prisma.itinerary.findFirst({
    where: { id: itineraryId, userId },
    select: { id: true },
  });
  if (!itinerary) return false;
  const events = await computeItineraryEvents(itineraryId, { syncableOnly: true });
  return events.some((e) => e.id === eventId);
}

export function serializeItineraryEvent(
  event: EventWithHost
): import('@/lib/itineraryConstants').ItineraryEventRow {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    url: event.url,
    location: event.location,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    timezone: event.timezone,
    temporalKind: event.temporalKind,
    hubId: event.hubId,
    hubHostId: event.hubHostId,
    source: event.source,
    sponsoredBy: event.sponsoredBy,
    sponsorKind: event.sponsorKind,
    hostName: event.hubHost?.name ?? null,
    hostSlug: event.hubHost?.slug ?? null,
    gcalSyncable: isItineraryGcalSyncableEvent(event),
  };
}

export async function markItinerariesPendingForEvent(eventId: string) {
  const items = await prisma.itineraryItem.findMany({
    where: {
      OR: [
        { eventId },
        { hubHost: { events: { some: { id: eventId } } } },
        { hub: { events: { some: { id: eventId } } } },
      ],
    },
    select: { itineraryId: true },
  });
  const ids = [...new Set(items.map((i) => i.itineraryId))];
  if (ids.length === 0) return;
  await prisma.itinerary.updateMany({
    where: { id: { in: ids }, gcalSyncEnabled: true },
    data: { gcalSyncPending: true },
  });
}
