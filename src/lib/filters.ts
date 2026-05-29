/**
 * Shared filter matching logic for subscription filters
 * Used by filter subscription creation, event publish hooks, and feed generation
 */

import { eventContainedInDateRange } from './eventTemporal';

export interface Filter {
  tags?: string[];
  country?: string;
  region?: string;
  city?: string;
  source?: string;
  hubSlug?: string;
  hostSlugs?: string[];
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
  hubId?: string | null;
  hubHostId?: string | null;
  start: Date | string;
  end: Date | string;
  timezone?: string | null;
  temporalKind?: string | null;
  allDayStartDate?: Date | string | null;
  allDayEndDate?: Date | string | null;
  status?: string;
}

/** Resolved hub/host IDs for matching filters that use slugs */
export interface FilterMatchContext {
  hubId?: string;
  hostIds?: Set<string>;
}

/**
 * Check if an event matches a single filter criterion
 */
export function eventMatchesFilter(
  event: EventLike,
  filter: Filter,
  context?: FilterMatchContext
): boolean {
  if (filter.hubSlug) {
    if (!context?.hubId || event.hubId !== context.hubId) {
      return false;
    }
  }

  if (filter.hostSlugs && filter.hostSlugs.length > 0) {
    if (!context?.hostIds || !event.hubHostId || !context.hostIds.has(event.hubHostId)) {
      return false;
    }
  }

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

  if (filter.country) {
    if (event.country !== filter.country) return false;
  }

  if (filter.region) {
    if (event.region !== filter.region) return false;
  }

  if (filter.city) {
    if (!event.city) return false;
    if (!event.city.toLowerCase().includes(filter.city.toLowerCase())) return false;
  }

  if (filter.source) {
    if (event.source !== filter.source) return false;
  }

  if (filter.dateRange) {
    if (
      !eventContainedInDateRange(
        {
          start: new Date(event.start),
          end: new Date(event.end),
          timezone: event.timezone ?? null,
          temporalKind: event.temporalKind ?? null,
          allDayStartDate: event.allDayStartDate ? new Date(event.allDayStartDate) : null,
          allDayEndDate: event.allDayEndDate ? new Date(event.allDayEndDate) : null,
        },
        filter.dateRange
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Get all events that match a filter (sync; pass context when using hubSlug/hostSlugs)
 */
export function getMatchingEvents<T extends EventLike>(
  events: T[],
  filter: Filter,
  context?: FilterMatchContext
): T[] {
  return events.filter((event) => eventMatchesFilter(event, filter, context));
}

export function parseFilter(filterJson: string | null | undefined): Filter | null {
  if (!filterJson) return null;
  try {
    return JSON.parse(filterJson) as Filter;
  } catch {
    return null;
  }
}

export function isFilterEmpty(filter: Filter): boolean {
  return (
    (!filter.tags || filter.tags.length === 0) &&
    !filter.country &&
    !filter.region &&
    !filter.city &&
    !filter.source &&
    !filter.hubSlug &&
    (!filter.hostSlugs || filter.hostSlugs.length === 0) &&
    (!filter.dateRange || (!filter.dateRange.start && !filter.dateRange.end))
  );
}

export function getFilterDescription(filter: Filter): string {
  const parts: string[] = [];

  if (filter.hubSlug) {
    parts.push(`Hub: ${filter.hubSlug}`);
  }
  if (filter.hostSlugs && filter.hostSlugs.length > 0) {
    parts.push(`Hosts: ${filter.hostSlugs.join(', ')}`);
  }
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

export function calculateFilterStats<T extends EventLike>(
  allEvents: T[],
  filter: Filter,
  context?: FilterMatchContext
): { matchCount: number; totalCount: number; percentage: number } {
  const matchingEvents = getMatchingEvents(allEvents, filter, context);
  const totalCount = allEvents.length;
  const matchCount = matchingEvents.length;
  const percentage = totalCount > 0 ? Math.round((matchCount / totalCount) * 100) : 0;

  return { matchCount, totalCount, percentage };
}
