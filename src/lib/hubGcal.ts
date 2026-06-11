import 'server-only';
import type { Event } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  type Filter,
  getMatchingEvents,
  parseFilter,
} from '@/lib/filters';
import {
  getHubFeedPrefix,
  parseHubTheme,
  resolveFilterHubContext,
} from '@/lib/hubs';
import { isHubGcalSyncableEvent } from '@/lib/itinerary';
import {
  convertEventToGoogleCalendar,
  deleteCalendarBestEffort,
  deleteEventFromGoogleCalendar,
  ensureDedicatedCalendar,
  generateEventICalUID,
  type GoogleCalendarEvent,
  type ProvisionResult,
  upsertEventToGoogleCalendar,
  verifyCalendarExists,
} from '@/lib/gcal';

export interface HubGoogleTokens {
  accessToken: string;
  refreshToken?: string;
}

export async function getGoogleTokensForUser(
  userId: string
): Promise<HubGoogleTokens | null> {
  const googleAccount = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
    select: { access_token: true, refresh_token: true },
  });
  if (!googleAccount?.access_token) return null;
  return {
    accessToken: googleAccount.access_token,
    refreshToken: googleAccount.refresh_token || undefined,
  };
}

export function convertHubEventToGoogleCalendar(
  event: Event,
  hubName: string,
  themeJson?: string | null
): GoogleCalendarEvent {
  const theme = parseHubTheme(themeJson);
  const prefix = getHubFeedPrefix(theme, hubName);
  const base = convertEventToGoogleCalendar(event);
  return {
    ...base,
    summary: `${prefix} ${event.title}`,
    source: event.url
      ? { title: hubName, url: event.url }
      : undefined,
  };
}

/**
 * Union of events to sync for a hub: active HUB subscriptions + manual hub follows.
 */
export async function computeHubEventsToSync(
  userId: string,
  hubId: string
): Promise<Event[]> {
  const hub = await prisma.eventHub.findUnique({
    where: { id: hubId },
    select: { slug: true },
  });
  if (!hub) return [];

  const hubEvents = await prisma.event.findMany({
    where: { hubId, status: 'PUBLISHED' },
  });

  const eventIdSet = new Set<string>();
  const result: Event[] = [];

  const addEvent = (event: Event) => {
    if (!isHubGcalSyncableEvent(event)) return;
    if (!eventIdSet.has(event.id)) {
      eventIdSet.add(event.id);
      result.push(event);
    }
  };

  const hubSubscriptions = await prisma.subscription.findMany({
    where: {
      userId,
      kind: 'HUB',
      active: true,
      filter: { not: null },
    },
  });

  for (const subscription of hubSubscriptions) {
    const filter = parseFilter(subscription.filter);
    if (!filter?.hubSlug || filter.hubSlug !== hub.slug) continue;

    const context = await resolveFilterHubContext(filter);
    const exclusions = await prisma.filterExclusion.findMany({
      where: { userId, subscriptionId: subscription.id },
      select: { eventId: true },
    });
    const excludedIds = new Set(exclusions.map((e) => e.eventId));

    const matched = getMatchingEvents(hubEvents, filter as Filter, context);
    for (const event of matched) {
      if (!excludedIds.has(event.id)) {
        addEvent(event);
      }
    }
  }

  const manualFollows = await prisma.eventFollow.findMany({
    where: {
      userId,
      event: { hubId, status: 'PUBLISHED' },
    },
    include: { event: true },
  });

  for (const follow of manualFollows) {
    addEvent(follow.event);
  }

  return result.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}

export async function isEventInHubSyncScope(
  userId: string,
  hubId: string,
  eventId: string
): Promise<boolean> {
  const events = await computeHubEventsToSync(userId, hubId);
  return events.some((e) => e.id === eventId);
}

export async function hasActiveHubSubscription(
  userId: string,
  hubSlug: string
): Promise<boolean> {
  const subs = await prisma.subscription.findMany({
    where: { userId, kind: 'HUB', active: true, filter: { not: null } },
  });
  return subs.some((sub) => {
    const filter = parseFilter(sub.filter);
    return filter?.hubSlug === hubSlug;
  });
}

export async function provisionAndClaimHubCalendar(
  userId: string,
  hubId: string,
  accessToken: string,
  refreshToken: string | undefined
): Promise<ProvisionResult> {
  const hub = await prisma.eventHub.findUnique({
    where: { id: hubId },
    select: { id: true, name: true, timezone: true },
  });
  if (!hub) {
    throw new Error('Hub not found');
  }

  const existing = await prisma.hubCalendarSync.findUnique({
    where: { userId_hubId: { userId, hubId } },
    select: { gcalCalendarId: true },
  });

  if (existing?.gcalCalendarId) {
    const exists = await verifyCalendarExists(
      accessToken,
      refreshToken,
      existing.gcalCalendarId
    );
    if (exists) {
      return { calendarId: existing.gcalCalendarId, action: 'existing' };
    }
    await prisma.hubCalendarSync.update({
      where: { userId_hubId: { userId, hubId } },
      data: { gcalCalendarId: null },
    });
  }

  await prisma.hubCalendarSync.upsert({
    where: { userId_hubId: { userId, hubId } },
    create: { userId, hubId },
    update: {},
  });

  const { calendarId: candidateId, created: wasCreated } = await ensureDedicatedCalendar(
    accessToken,
    refreshToken,
    {
      summary: hub.name,
      description: `Synced festival events from themediacalendar.com`,
      timeZone: hub.timezone || process.env.DEFAULT_TIMEZONE || 'America/New_York',
    }
  );

  const claimResult = await prisma.hubCalendarSync.updateMany({
    where: {
      userId,
      hubId,
      gcalCalendarId: null,
    },
    data: {
      gcalCalendarId: candidateId,
      gcalSyncEnabled: true,
    },
  });

  if (claimResult.count > 0) {
    return { calendarId: candidateId, action: wasCreated ? 'created' : 'claimed_existing' };
  }

  if (wasCreated) {
    await deleteCalendarBestEffort(accessToken, refreshToken, candidateId);
  }

  const updated = await prisma.hubCalendarSync.findUnique({
    where: { userId_hubId: { userId, hubId } },
    select: { gcalCalendarId: true },
  });

  if (!updated?.gcalCalendarId) {
    throw new Error('Failed to claim hub calendar');
  }

  return { calendarId: updated.gcalCalendarId, action: 'existing' };
}

export async function ensureHubCalendarSyncRow(userId: string, hubId: string) {
  return prisma.hubCalendarSync.upsert({
    where: { userId_hubId: { userId, hubId } },
    create: { userId, hubId, gcalSyncPending: true },
    update: {},
  });
}

export interface HubSyncResult {
  synced: number;
  removed: number;
  errors: string[];
  calendarId: string | null;
}

export async function syncHubEventsToGoogleCalendar(
  userId: string,
  hubId: string,
  tokens?: HubGoogleTokens | null
): Promise<HubSyncResult> {
  const result: HubSyncResult = {
    synced: 0,
    removed: 0,
    errors: [],
    calendarId: null,
  };

  const hubSync = await prisma.hubCalendarSync.findUnique({
    where: { userId_hubId: { userId, hubId } },
    include: { hub: { select: { name: true, theme: true } } },
  });

  if (!hubSync?.gcalCalendarId) {
    result.errors.push('Hub Google Calendar not provisioned');
    return result;
  }

  const googleTokens = tokens ?? (await getGoogleTokensForUser(userId));
  if (!googleTokens) {
    result.errors.push('Google Calendar not connected');
    await prisma.hubCalendarSync.update({
      where: { userId_hubId: { userId, hubId } },
      data: {
        gcalLastSyncError: 'Google Calendar not connected',
        gcalLastSyncAttemptAt: new Date(),
      },
    });
    return result;
  }

  const { accessToken, refreshToken } = googleTokens;
  const calendarId = hubSync.gcalCalendarId;
  result.calendarId = calendarId;

  const eventsToSync = await computeHubEventsToSync(userId, hubId);
  const syncedEventIds = new Set<string>();

  for (const event of eventsToSync) {
    try {
      const gcalEvent = convertHubEventToGoogleCalendar(
        event,
        hubSync.hub.name,
        hubSync.hub.theme
      );
      const gcalEventId = await upsertEventToGoogleCalendar(
        accessToken,
        refreshToken,
        calendarId,
        gcalEvent
      );

      await prisma.userEventSync.upsert({
        where: {
          userId_eventId_gcalCalendarId: {
            userId,
            eventId: event.id,
            gcalCalendarId: calendarId,
          },
        },
        create: {
          userId,
          eventId: event.id,
          gcalCalendarId: calendarId,
          gcalEventId,
        },
        update: {
          gcalEventId,
          syncedAt: new Date(),
        },
      });

      syncedEventIds.add(event.id);
      result.synced++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to sync "${event.title}": ${msg}`);
    }
  }

  const currentSyncs = await prisma.userEventSync.findMany({
    where: {
      userId,
      gcalCalendarId: calendarId,
      event: { hubId },
    },
  });

  for (const sync of currentSyncs) {
    if (!syncedEventIds.has(sync.eventId)) {
      try {
        const iCalUID = generateEventICalUID(sync.eventId);
        await deleteEventFromGoogleCalendar(
          accessToken,
          refreshToken,
          calendarId,
          iCalUID
        );
        result.removed++;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Failed to remove event ${sync.eventId}: ${msg}`);
      }
      await prisma.userEventSync.delete({ where: { id: sync.id } });
    }
  }

  await prisma.hubCalendarSync.update({
    where: { userId_hubId: { userId, hubId } },
    data: {
      gcalSyncPending: false,
      gcalLastSyncedAt: new Date(),
      gcalLastSyncError:
        result.errors.length > 0 ? result.errors.join('; ') : null,
      gcalLastSyncAttemptAt: new Date(),
    },
  });

  return result;
}

export async function syncHubEventIfConnected(
  userId: string,
  event: Event
): Promise<boolean> {
  if (!event.hubId) return false;
  if (!isHubGcalSyncableEvent(event)) return false;

  const hubSync = await prisma.hubCalendarSync.findUnique({
    where: { userId_hubId: { userId, hubId: event.hubId } },
    include: { hub: { select: { name: true, theme: true } } },
  });

  if (!hubSync?.gcalCalendarId || !hubSync.gcalSyncEnabled) {
    return false;
  }

  const tokens = await getGoogleTokensForUser(userId);
  if (!tokens) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalSyncEnabled: true },
  });
  if (!user?.gcalSyncEnabled) return false;

  try {
    const gcalEvent = convertHubEventToGoogleCalendar(
      event,
      hubSync.hub.name,
      hubSync.hub.theme
    );
    const gcalEventId = await upsertEventToGoogleCalendar(
      tokens.accessToken,
      tokens.refreshToken,
      hubSync.gcalCalendarId,
      gcalEvent
    );

    await prisma.userEventSync.upsert({
      where: {
        userId_eventId_gcalCalendarId: {
          userId,
          eventId: event.id,
          gcalCalendarId: hubSync.gcalCalendarId,
        },
      },
      create: {
        userId,
        eventId: event.id,
        gcalCalendarId: hubSync.gcalCalendarId,
        gcalEventId,
      },
      update: {
        gcalEventId,
        syncedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to sync hub event to Google Calendar:', error);
    return false;
  }
}

export async function provisionAndSyncHub(
  userId: string,
  hubId: string
): Promise<HubSyncResult> {
  await ensureHubCalendarSyncRow(userId, hubId);

  const tokens = await getGoogleTokensForUser(userId);
  if (!tokens) {
    await prisma.hubCalendarSync.update({
      where: { userId_hubId: { userId, hubId } },
      data: { gcalSyncPending: true },
    });
    return {
      synced: 0,
      removed: 0,
      errors: ['Google Calendar not connected'],
      calendarId: null,
    };
  }

  await provisionAndClaimHubCalendar(
    userId,
    hubId,
    tokens.accessToken,
    tokens.refreshToken
  );

  return syncHubEventsToGoogleCalendar(userId, hubId, tokens);
}

export async function getHubGcalConnected(
  userId: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalSyncEnabled: true },
  });
  const tokens = await getGoogleTokensForUser(userId);
  return !!user?.gcalSyncEnabled && !!tokens;
}
