/** Client-safe itinerary constants and types */

export const ITINERARY_LIMITS = {
  MAX_PER_USER: 10,
  MAX_GCAL_CONNECTED: 5,
  MAX_EVENTS: 500,
  MAX_GCAL_UPSERTS_PER_REQUEST: 10,
  SYNC_BATCH_SIZE: 25,
  CRON_TAKE: 50,
  PREVIEW_CONFIRM_THRESHOLD: 20,
  MAX_VISIBLE_OVERLAP_COLUMNS: 3,
  MIN_EVENT_BLOCK_HEIGHT_PX: 44,
} as const;

export const ITINERARY_ITEM_KIND = {
  EVENT: 'EVENT',
  HOST: 'HOST',
  HUB: 'HUB',
} as const;

export type ItineraryItemKind =
  (typeof ITINERARY_ITEM_KIND)[keyof typeof ITINERARY_ITEM_KIND];

export const ITINERARY_GCAL_PREFIX = 'TMC: ';

export interface ItinerarySummary {
  id: string;
  name: string;
  slug: string;
  optionalHubId: string | null;
  hubSlug: string | null;
  hubName: string | null;
  hubTimezone: string | null;
  eventCount: number;
  timedEventCount: number;
  gcalSyncEnabled: boolean;
  gcalSyncPending: boolean;
  gcalLastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItineraryItemRow {
  id: string;
  kind: ItineraryItemKind;
  eventId: string | null;
  hubHostId: string | null;
  hubId: string | null;
  label: string;
  createdAt: string;
}

export interface ItineraryPreviewAddResponse {
  kind: ItineraryItemKind;
  newEventCount: number;
  newTimedEventCount: number;
  allDayExcludedCount: number;
  totalAfter: number;
  exceedsCap: boolean;
  requiresConfirm: boolean;
  maxEvents: number;
}

export interface ItineraryEventsResponse {
  itineraryId: string;
  displayTimezone: string;
  day?: string;
  events: ItineraryEventRow[];
  stats: {
    total: number;
    timed: number;
    allDay: number;
  };
}

export interface ItineraryEventRow {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  start: string;
  end: string;
  timezone: string | null;
  temporalKind: string | null;
  hubId: string | null;
  hubHostId: string | null;
  source: string | null;
  sponsoredBy: string | null;
  sponsorKind: string | null;
  hostName: string | null;
  hostSlug: string | null;
  gcalSyncable: boolean;
}

export interface ItineraryGcalStatusResponse {
  itineraryId: string;
  itinerarySlug: string;
  itineraryName: string;
  gcalConnected: boolean;
  gcalProvisioned: boolean;
  sync: {
    enabled: boolean;
    pending: boolean;
    calendarId: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  } | null;
  eventCount: number;
  timedEventCount: number;
  syncedEventIds: string[];
}
