import 'server-only';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export type HubStatus = 'DRAFT' | 'UPCOMING' | 'LIVE' | 'ARCHIVED';

export interface HubTheme {
  accent?: string;
  heroGradient?: string;
  surface?: string;
  label?: string;
}

/** Events shown on the main calendar (excludes hub-scoped events by default). */
export function mainCalendarEventWhere(
  status: string = 'PUBLISHED'
): Prisma.EventWhereInput {
  return {
    status,
    OR: [{ hubId: null }, { showOnMainCalendar: true }],
  };
}

export function parseHubTheme(themeJson: string | null | undefined): HubTheme {
  if (!themeJson) return { label: 'Festival' };
  try {
    return JSON.parse(themeJson) as HubTheme;
  } catch {
    return { label: 'Festival' };
  }
}

export function getHubFeedPrefix(theme: HubTheme, hubName: string): string {
  const label = theme.label || hubName.split(' ')[0] || 'Hub';
  return `[${label}]`;
}

/** When hubId is set, default off main calendar unless explicitly enabled. */
export function applyHubEventDefaults(data: {
  hubId?: string | null;
  showOnMainCalendar?: boolean;
}): { showOnMainCalendar: boolean } {
  if (data.hubId) {
    return { showOnMainCalendar: data.showOnMainCalendar ?? false };
  }
  return { showOnMainCalendar: data.showOnMainCalendar ?? false };
}

export function appendHubTag(
  tagsJson: string | null | undefined,
  hubSlug: string
): string {
  let tags: string[] = [];
  if (tagsJson) {
    try {
      const parsed = JSON.parse(tagsJson);
      if (Array.isArray(parsed)) tags = parsed;
    } catch {
      /* ignore */
    }
  }
  if (!tags.includes(hubSlug)) {
    tags.push(hubSlug);
  }
  return JSON.stringify(tags);
}

export async function getHubBySlug(slug: string) {
  return prisma.eventHub.findUnique({
    where: { slug },
    include: {
      hosts: {
        orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: {
            select: {
              events: { where: { status: 'PUBLISHED' } },
            },
          },
        },
      },
      _count: {
        select: {
          events: { where: { status: 'PUBLISHED' } },
        },
      },
    },
  });
}

export async function listHubs(statuses?: HubStatus[]) {
  const where: Prisma.EventHubWhereInput = {};
  if (statuses && statuses.length > 0) {
    where.status = { in: statuses };
  }
  return prisma.eventHub.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { start: 'asc' }],
    include: {
      _count: {
        select: {
          events: { where: { status: 'PUBLISHED' } },
          hosts: true,
        },
      },
    },
  });
}

export async function getHostBySlug(hubSlug: string, hostSlug: string) {
  const hub = await prisma.eventHub.findUnique({
    where: { slug: hubSlug },
    select: { id: true, slug: true, name: true, theme: true },
  });
  if (!hub) return null;

  const host = await prisma.hubHost.findUnique({
    where: {
      hubId_slug: { hubId: hub.id, slug: hostSlug },
    },
    include: {
      hub: true,
      _count: {
        select: {
          events: { where: { status: 'PUBLISHED' } },
        },
      },
    },
  });

  return host ? { hub, host } : null;
}

export async function getHubEvents(
  hubId: string,
  options?: {
    hostId?: string;
    tags?: string[];
    q?: string;
    limit?: number;
  }
) {
  const where: Prisma.EventWhereInput = {
    hubId,
    status: 'PUBLISHED',
  };

  if (options?.hostId) {
    where.hubHostId = options.hostId;
  }

  if (options?.q) {
    where.OR = [
      { title: { contains: options.q, mode: 'insensitive' } },
      { description: { contains: options.q, mode: 'insensitive' } },
      { location: { contains: options.q, mode: 'insensitive' } },
    ];
  }

  let events = await prisma.event.findMany({
    where,
    orderBy: { start: 'asc' },
    take: options?.limit ?? 500,
    include: {
      hubHost: { select: { slug: true, name: true, logoUrl: true } },
    },
  });

  if (options?.tags && options.tags.length > 0) {
    events = events.filter((event) => {
      if (!event.tags) return false;
      try {
        const eventTags = JSON.parse(event.tags) as string[];
        return options.tags!.some((t) => eventTags.includes(t));
      } catch {
        return false;
      }
    });
  }

  return events;
}

export async function resolveHostForIngest(
  hubId: string,
  sourceString: string | null | undefined
): Promise<string | null> {
  if (!sourceString?.trim()) return null;

  const normalized = sourceString.trim();
  const hosts = await prisma.hubHost.findMany({
    where: { hubId },
    select: { id: true, name: true, sourceAlias: true, slug: true },
  });

  for (const host of hosts) {
    if (host.sourceAlias && host.sourceAlias.toLowerCase() === normalized.toLowerCase()) {
      return host.id;
    }
    if (host.name.toLowerCase() === normalized.toLowerCase()) {
      return host.id;
    }
    if (host.slug.toLowerCase() === normalized.toLowerCase().replace(/\s+/g, '-')) {
      return host.id;
    }
  }

  return null;
}

export async function resolveFilterHubContext(filter: {
  hubSlug?: string;
  hostSlugs?: string[];
}): Promise<{ hubId?: string; hostIds?: Set<string> }> {
  if (!filter.hubSlug) return {};

  const hub = await prisma.eventHub.findUnique({
    where: { slug: filter.hubSlug },
    select: { id: true },
  });
  if (!hub) return {};

  const result: { hubId: string; hostIds?: Set<string> } = { hubId: hub.id };

  if (filter.hostSlugs && filter.hostSlugs.length > 0) {
    const hosts = await prisma.hubHost.findMany({
      where: {
        hubId: hub.id,
        slug: { in: filter.hostSlugs },
      },
      select: { id: true },
    });
    result.hostIds = new Set(hosts.map((h) => h.id));
  }

  return result;
}

export async function getHostPreviewEvents(hostId: string, limit = 3) {
  return prisma.event.findMany({
    where: { hubHostId: hostId, status: 'PUBLISHED' },
    orderBy: { start: 'asc' },
    take: limit,
    select: {
      id: true,
      title: true,
      start: true,
      end: true,
      location: true,
    },
  });
}
