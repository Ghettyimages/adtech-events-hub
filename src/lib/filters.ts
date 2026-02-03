/**
 * Shared filter matching logic for subscription filters
 * Used by filter subscription creation, event publish hooks, and feed generation
 */

export interface Filter {
  tags?: string[];
  country?: string;
  region?: string;
  city?: string;
  source?: string;
  dateRange?: {
    start?: string;
    end?: string;
  };
}

export interface EventLike {
  id: string;
  tags?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  source?: string | null;
  start: Date | string;
  end: Date | string;
  status?: string;
}

/**
 * Check if an event matches a single filter criterion
 */
export function eventMatchesFilter(event: EventLike, filter: Filter): boolean {
  // Filter by tags - event must have at least one matching tag
  if (filter.tags && filter.tags.length > 0) {
    if (!event.tags) return false;
    try {
      const eventTags = typeof event.tags === 'string' ? JSON.parse(event.tags) : event.tags;
      if (!Array.isArray(eventTags)) return false;
      const hasMatchingTag = filter.tags.some((tag) => eventTags.includes(tag));
      if (!hasMatchingTag) return false;
    } catch {
      return false;
    }
  }

  // Filter by country - exact match
  if (filter.country) {
    if (event.country !== filter.country) return false;
  }

  // Filter by region - exact match
  if (filter.region) {
    if (event.region !== filter.region) return false;
  }

  // Filter by city - case-insensitive contains
  if (filter.city) {
    if (!event.city) return false;
    if (!event.city.toLowerCase().includes(filter.city.toLowerCase())) return false;
  }

  // Filter by source - exact match
  if (filter.source) {
    if (event.source !== filter.source) return false;
  }

  // Filter by date range
  if (filter.dateRange) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    if (filter.dateRange.start) {
      const filterStart = new Date(filter.dateRange.start);
      if (eventStart < filterStart) return false;
    }

    if (filter.dateRange.end) {
      const filterEnd = new Date(filter.dateRange.end);
      if (eventEnd > filterEnd) return false;
    }
  }

  // All conditions passed
  return true;
}

/**
 * Get all events that match a filter
 */
export function getMatchingEvents<T extends EventLike>(events: T[], filter: Filter): T[] {
  return events.filter((event) => eventMatchesFilter(event, filter));
}

/**
 * Parse a filter from JSON string, returning null if invalid
 */
export function parseFilter(filterJson: string | null | undefined): Filter | null {
  if (!filterJson) return null;
  try {
    return JSON.parse(filterJson) as Filter;
  } catch {
    return null;
  }
}

/**
 * Check if a filter is empty (no criteria set)
 */
export function isFilterEmpty(filter: Filter): boolean {
  return (
    (!filter.tags || filter.tags.length === 0) &&
    !filter.country &&
    !filter.region &&
    !filter.city &&
    !filter.source &&
    (!filter.dateRange || (!filter.dateRange.start && !filter.dateRange.end))
  );
}

/**
 * Generate a human-readable description of a filter
 */
export function getFilterDescription(filter: Filter): string {
  const parts: string[] = [];

  if (filter.tags && filter.tags.length > 0) {
    parts.push(`Tags: ${filter.tags.join(', ')}`);
  }
  if (filter.country) {
    parts.push(`Country: ${filter.country}`);
  }
  if (filter.region) {
    parts.push(`Region: ${filter.region}`);
  }
  if (filter.city) {
    parts.push(`City: ${filter.city}`);
  }
  if (filter.source) {
    parts.push(`Source: ${filter.source}`);
  }
  if (filter.dateRange) {
    if (filter.dateRange.start && filter.dateRange.end) {
      parts.push(`Date: ${filter.dateRange.start} to ${filter.dateRange.end}`);
    } else if (filter.dateRange.start) {
      parts.push(`From: ${filter.dateRange.start}`);
    } else if (filter.dateRange.end) {
      parts.push(`Until: ${filter.dateRange.end}`);
    }
  }

  return parts.length > 0 ? parts.join(' • ') : 'All events';
}

/**
 * Calculate the match percentage and count for a filter
 */
export function calculateFilterStats<T extends EventLike>(
  allEvents: T[],
  filter: Filter
): { matchCount: number; totalCount: number; percentage: number } {
  const matchingEvents = getMatchingEvents(allEvents, filter);
  const totalCount = allEvents.length;
  const matchCount = matchingEvents.length;
  const percentage = totalCount > 0 ? Math.round((matchCount / totalCount) * 100) : 0;

  return { matchCount, totalCount, percentage };
}

/**
 * Process filter subscriptions for a newly published event
 * Creates EventFollow records for users whose filters match the event
 * Returns the number of new follows created
 */
export async function processFilterSubscriptionsForEvent(
  eventId: string,
  event: EventLike
): Promise<number> {
  // Dynamic import to avoid circular dependencies
  const { prisma } = await import('@/lib/db');

  // Get all active filter subscriptions
  const filterSubscriptions = await prisma.subscription.findMany({
    where: {
      kind: 'CUSTOM',
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

  // Get existing follows for this event to avoid duplicates
  const existingFollows = await prisma.eventFollow.findMany({
    where: { eventId },
    select: { userId: true },
  });
  const existingFollowUserIds = new Set(existingFollows.map((f) => f.userId));

  // Get exclusions for this event
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

  // Find subscriptions whose filters match the event
  const matchingSubscriptions: { subscriptionId: string; userId: string }[] = [];

  for (const subscription of filterSubscriptions) {
    // Skip if user already follows this event
    if (existingFollowUserIds.has(subscription.userId)) {
      continue;
    }

    // Skip if user has excluded this event for this filter
    const userExclusions = exclusionMap.get(subscription.userId);
    if (userExclusions?.has(subscription.id)) {
      continue;
    }

    // Check if event matches the filter
    const filter = parseFilter(subscription.filter);
    if (filter && eventMatchesFilter(event, filter)) {
      matchingSubscriptions.push({
        subscriptionId: subscription.id,
        userId: subscription.userId,
      });
    }
  }

  if (matchingSubscriptions.length === 0) {
    return 0;
  }

  // Batch create EventFollow records
  await prisma.eventFollow.createMany({
    data: matchingSubscriptions.map((sub) => ({
      userId: sub.userId,
      eventId,
      subscriptionId: sub.subscriptionId,
      source: 'FILTER',
    })),
    skipDuplicates: true,
  });

  // Update subscriber count (single increment by the number of new follows)
  await prisma.event.update({
    where: { id: eventId },
    data: {
      subscribers: { increment: matchingSubscriptions.length },
    },
  });

  return matchingSubscriptions.length;
}
