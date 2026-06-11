import 'server-only';
import type { Event } from '@prisma/client';
import { prisma } from '@/lib/db';
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
import { getHubFeedPrefix, parseHubTheme } from '@/lib/hubs';
import {
  computeItineraryEvents,
  isItineraryGcalSyncableEvent,
} from '@/lib/itinerary';
import { ITINERARY_GCAL_PREFIX, ITINERARY_LIMITS } from '@/lib/itineraryConstants';
import {
  getGoogleTokensForUser,
  type HubGoogleTokens,
} from '@/lib/hubGcal';

export { getGoogleTokensForUser };

function itineraryCalendarSummary(name: string): string {
  return `${ITINERARY_GCAL_PREFIX}${name}`;
}

export function convertItineraryEventToGoogleCalendar(
  event: Event,
  itineraryName: string,
  hubName?: string | null,
  themeJson?: string | null
): GoogleCalendarEvent {
  const base = convertEventToGoogleCalendar(event);
  if (event.hubId && hubName) {
    const theme = parseHubTheme(themeJson);
    const prefix = getHubFeedPrefix(theme, hubName);
    return {
      ...base,
      summary: `${prefix} ${event.title}`,
      source: event.url ? { title: hubName, url: event.url } : undefined,
    };
  }
  return {
    ...base,
    summary: event.title,
    source: event.url
      ? { title: itineraryName, url: event.url }
      : undefined,
  };
}

export async function computeItineraryEventsToSync(
  itineraryId: string
): Promise<Event[]> {
  return computeItineraryEvents(itineraryId, { syncableOnly: true });
}

export async function isEventInItinerarySyncScope(
  itineraryId: string,
  eventId: string
): Promise<boolean> {
  const events = await computeItineraryEventsToSync(itineraryId);
  return events.some((e) => e.id === eventId);
}

export async function provisionAndClaimItineraryCalendar(
  userId: string,
  itineraryId: string,
  accessToken: string,
  refreshToken: string | undefined
): Promise<ProvisionResult> {
  const itinerary = await prisma.itinerary.findFirst({
    where: { id: itineraryId, userId },
    include: { hub: { select: { timezone: true } } },
  });
  if (!itinerary) {
    throw new Error('Itinerary not found');
  }

  if (itinerary.gcalCalendarId) {
    const exists = await verifyCalendarExists(
      accessToken,
      refreshToken,
      itinerary.gcalCalendarId
    );
    if (exists) {
      return { calendarId: itinerary.gcalCalendarId, action: 'existing' };
    }
    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { gcalCalendarId: null },
    });
  }

  const summary = itineraryCalendarSummary(itinerary.name);
  const { calendarId: candidateId, created: wasCreated } =
    await ensureDedicatedCalendar(accessToken, refreshToken, {
      summary,
      description: `Personal itinerary synced from themediacalendar.com`,
      timeZone:
        itinerary.hub?.timezone ||
        process.env.DEFAULT_TIMEZONE ||
        'America/New_York',
    });

  const claimResult = await prisma.itinerary.updateMany({
    where: {
      id: itineraryId,
      userId,
      gcalCalendarId: null,
    },
    data: {
      gcalCalendarId: candidateId,
      gcalSyncEnabled: true,
    },
  });

  if (claimResult.count > 0) {
    return {
      calendarId: candidateId,
      action: wasCreated ? 'created' : 'claimed_existing',
    };
  }

  if (wasCreated) {
    await deleteCalendarBestEffort(accessToken, refreshToken, candidateId);
  }

  const updated = await prisma.itinerary.findUnique({
    where: { id: itineraryId },
    select: { gcalCalendarId: true },
  });
  if (!updated?.gcalCalendarId) {
    throw new Error('Failed to claim itinerary calendar');
  }
  return { calendarId: updated.gcalCalendarId, action: 'existing' };
}

export interface ItinerarySyncResult {
  synced: number;
  removed: number;
  errors: string[];
  calendarId: string | null;
  pending: boolean;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncItineraryEventsToGoogleCalendar(
  userId: string,
  itineraryId: string,
  tokens?: HubGoogleTokens | null,
  options?: { maxInline?: number }
): Promise<ItinerarySyncResult> {
  const result: ItinerarySyncResult = {
    synced: 0,
    removed: 0,
    errors: [],
    calendarId: null,
    pending: false,
  };

  const itinerary = await prisma.itinerary.findFirst({
    where: { id: itineraryId, userId },
    include: {
      hub: { select: { name: true, theme: true, timezone: true } },
    },
  });

  if (!itinerary?.gcalCalendarId) {
    result.errors.push('Itinerary Google Calendar not provisioned');
    return result;
  }

  const googleTokens = tokens ?? (await getGoogleTokensForUser(userId));
  if (!googleTokens) {
    result.errors.push('Google Calendar not connected');
    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: {
        gcalLastSyncError: 'Google Calendar not connected',
        gcalLastSyncAttemptAt: new Date(),
      },
    });
    return result;
  }

  const { accessToken, refreshToken } = googleTokens;
  const calendarId = itinerary.gcalCalendarId;
  result.calendarId = calendarId;

  const eventsToSync = await computeItineraryEventsToSync(itineraryId);
  if (eventsToSync.length > ITINERARY_LIMITS.MAX_EVENTS) {
    result.errors.push(
      `Itinerary exceeds ${ITINERARY_LIMITS.MAX_EVENTS} event cap`
    );
    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: {
        gcalLastSyncError: result.errors.join('; '),
        gcalLastSyncAttemptAt: new Date(),
      },
    });
    return result;
  }

  const maxInline =
    options?.maxInline ?? ITINERARY_LIMITS.MAX_GCAL_UPSERTS_PER_REQUEST;
  if (eventsToSync.length > maxInline) {
    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { gcalSyncPending: true },
    });
    result.pending = true;
  }

  const syncedEventIds = new Set<string>();
  const batchSize = ITINERARY_LIMITS.SYNC_BATCH_SIZE;

  for (let i = 0; i < eventsToSync.length; i++) {
    const event = eventsToSync[i];
    try {
      const gcalEvent = convertItineraryEventToGoogleCalendar(
        event,
        itinerary.name,
        itinerary.hub?.name,
        itinerary.hub?.theme ?? null
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

    if ((i + 1) % batchSize === 0) {
      await sleep(150);
    }
  }

  const currentSyncs = await prisma.userEventSync.findMany({
    where: { userId, gcalCalendarId: calendarId },
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

  await prisma.itinerary.update({
    where: { id: itineraryId },
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

export async function syncItineraryEventIfConnected(
  userId: string,
  itineraryId: string,
  event: Event
): Promise<boolean> {
  if (!isItineraryGcalSyncableEvent(event)) return false;

  const itinerary = await prisma.itinerary.findFirst({
    where: { id: itineraryId, userId },
    include: { hub: { select: { name: true, theme: true } } },
  });

  if (!itinerary?.gcalCalendarId || !itinerary.gcalSyncEnabled) {
    return false;
  }

  const inScope = await isEventInItinerarySyncScope(itineraryId, event.id);
  if (!inScope) return false;

  const tokens = await getGoogleTokensForUser(userId);
  if (!tokens) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalSyncEnabled: true },
  });
  if (!user?.gcalSyncEnabled) return false;

  try {
    const gcalEvent = convertItineraryEventToGoogleCalendar(
      event,
      itinerary.name,
      itinerary.hub?.name,
      itinerary.hub?.theme ?? null
    );
    const gcalEventId = await upsertEventToGoogleCalendar(
      tokens.accessToken,
      tokens.refreshToken,
      itinerary.gcalCalendarId,
      gcalEvent
    );

    await prisma.userEventSync.upsert({
      where: {
        userId_eventId_gcalCalendarId: {
          userId,
          eventId: event.id,
          gcalCalendarId: itinerary.gcalCalendarId,
        },
      },
      create: {
        userId,
        eventId: event.id,
        gcalCalendarId: itinerary.gcalCalendarId,
        gcalEventId,
      },
      update: {
        gcalEventId,
        syncedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to sync itinerary event to Google Calendar:', error);
    return false;
  }
}

export async function syncItineraryItemsToConnectedCalendars(
  userId: string,
  event: Event
): Promise<number> {
  if (!isItineraryGcalSyncableEvent(event)) return 0;

  const itineraries = await prisma.itinerary.findMany({
    where: { userId, gcalSyncEnabled: true, gcalCalendarId: { not: null } },
    select: { id: true },
  });

  let synced = 0;
  for (const it of itineraries) {
    const ok = await syncItineraryEventIfConnected(userId, it.id, event);
    if (ok) synced++;
  }
  return synced;
}

export async function provisionAndSyncItinerary(
  userId: string,
  itineraryId: string
): Promise<ItinerarySyncResult> {
  const tokens = await getGoogleTokensForUser(userId);
  if (!tokens) {
    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { gcalSyncPending: true },
    });
    return {
      synced: 0,
      removed: 0,
      errors: ['Google Calendar not connected'],
      calendarId: null,
      pending: true,
    };
  }

  await provisionAndClaimItineraryCalendar(
    userId,
    itineraryId,
    tokens.accessToken,
    tokens.refreshToken
  );

  return syncItineraryEventsToGoogleCalendar(userId, itineraryId, tokens);
}

export async function getItineraryGcalConnected(
  userId: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalSyncEnabled: true },
  });
  const tokens = await getGoogleTokensForUser(userId);
  return !!user?.gcalSyncEnabled && !!tokens;
}
