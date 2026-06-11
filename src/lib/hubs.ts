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
    select: { id: true, slug: true, name: true, theme: true, timezone: true },
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
      { source: { contains: options.q, mode: 'insensitive' } },
      { city: { contains: options.q, mode: 'insensitive' } },
      { tags: { contains: options.q, mode: 'insensitive' } },
      { hubHost: { name: { contains: options.q, mode: 'insensitive' } } },
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

/** Turn a free-text host/source name into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Resolve a hub host from a write-in name. Matches an existing host first
 * (by sourceAlias / name / slug); if none match, creates a new host for the
 * hub using a slug derived from the confirmed name. Returns the host id, or
 * null when the name is blank.
 */
export async function resolveOrCreateHostByName(
  hubId: string,
  name: string | null | undefined
): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const existingId = await resolveHostForIngest(hubId, trimmed);
  if (existingId) return existingId;

  const slug = slugify(trimmed);
  if (!slug) return null;

  // Slug may already exist even if name/alias didn't match above.
  const clash = await prisma.hubHost.findUnique({
    where: { hubId_slug: { hubId, slug } },
  });
  if (clash) return clash.id;

  const created = await prisma.hubHost.create({
    data: { hubId, slug, name: trimmed, sourceAlias: trimmed },
  });
  return created.id;
}

export interface ResolveHostIngestOptions {
  hostSlug?: string | null;
  hostName?: string | null;
  source?: string | null;
  websiteUrl?: string | null;
}

/**
 * Resolve a hub host for CSV/scrape ingest. Matches existing hosts by slug, alias,
 * or name; creates a new host when host_slug or source/host_name is provided.
 */
export async function resolveOrCreateHostForIngest(
  hubId: string,
  opts: ResolveHostIngestOptions
): Promise<{ id: string; created: boolean } | null> {
  const hostSlug = opts.hostSlug?.trim();
  const hostName = opts.hostName?.trim();
  const source = opts.source?.trim();
  const websiteUrl = opts.websiteUrl?.trim() || null;

  if (hostSlug) {
    const existing = await prisma.hubHost.findUnique({
      where: { hubId_slug: { hubId, slug: hostSlug } },
    });
    if (existing) {
      if (websiteUrl && !existing.websiteUrl) {
        await prisma.hubHost.update({
          where: { id: existing.id },
          data: { websiteUrl },
        });
      }
      return { id: existing.id, created: false };
    }

    const name = hostName || source || hostSlug;
    const created = await prisma.hubHost.create({
      data: {
        hubId,
        slug: hostSlug,
        name,
        sourceAlias: source || name,
        websiteUrl,
      },
    });
    return { id: created.id, created: true };
  }

  const nameForResolve = hostName || source;
  if (!nameForResolve) return null;

  const existingId = await resolveHostForIngest(hubId, nameForResolve);
  if (existingId) {
    if (websiteUrl) {
      const host = await prisma.hubHost.findUnique({
        where: { id: existingId },
        select: { websiteUrl: true },
      });
      if (host && !host.websiteUrl) {
        await prisma.hubHost.update({
          where: { id: existingId },
          data: { websiteUrl },
        });
      }
    }
    return { id: existingId, created: false };
  }

  const createdId = await resolveOrCreateHostByName(hubId, nameForResolve);
  if (!createdId) return null;

  if (websiteUrl) {
    await prisma.hubHost.update({
      where: { id: createdId },
      data: { websiteUrl },
    });
  }

  const createdHost = await prisma.hubHost.findUnique({
    where: { id: createdId },
    select: { createdAt: true, updatedAt: true },
  });
  const wasJustCreated =
    createdHost != null &&
    createdHost.createdAt.getTime() === createdHost.updatedAt.getTime();

  return { id: createdId, created: wasJustCreated };
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
