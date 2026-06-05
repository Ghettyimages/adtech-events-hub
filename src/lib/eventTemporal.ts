/**
 * Canonical event date/time handling.
 *
 * ALL_DAY: civil dates are source of truth; start/end instants are 12:00Z / 22:00Z on those days.
 * TIMED: UTC instants + IANA timezone are source of truth.
 */

import { DateTime } from 'luxon';
import { format, startOfDay } from 'date-fns';
import type { Event } from '@prisma/client';

export const TEMPORAL_KIND = {
  ALL_DAY: 'ALL_DAY',
  TIMED: 'TIMED',
} as const;

export type TemporalKind = (typeof TEMPORAL_KIND)[keyof typeof TEMPORAL_KIND];

export const DEFAULT_TIMED_ZONE = 'America/New_York';

export const FESTIVAL_HUB_DEFAULT_ZONE = 'Europe/Paris';

export type EventTemporalRow = {
  start: Date;
  end: Date;
  timezone: string | null;
  temporalKind?: string | null;
  allDayStartDate?: Date | null;
  allDayEndDate?: Date | null;
};

export type EventTemporalInput = {
  temporalKind?: TemporalKind;
  /** ALL_DAY: YYYY-MM-DD. TIMED: ISO or datetime-local string */
  start: string;
  /** ALL_DAY: YYYY-MM-DD inclusive. TIMED: ISO or datetime-local */
  end: string;
  timezone?: string | null;
};

export type NormalizedEventTemporal = {
  temporalKind: TemporalKind;
  start: Date;
  end: Date;
  timezone: string | null;
  allDayStartDate: Date | null;
  allDayEndDate: Date | null;
};

export type GoogleCalendarPayload = {
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
};

export type ICalEventShape = {
  start: Date | DateTime;
  end: Date | DateTime;
  allDay: boolean;
  timezone?: string;
};

export type CsvTemporalRow = {
  start: string;
  end: string;
  timezone: string;
  all_day: string;
  temporal_kind: string;
};

export type RepairProjection = NormalizedEventTemporal & {
  needsStorageRepair: boolean;
  needsReview: boolean;
  exportSemanticsChange: boolean;
  repairBucket: 'auto_safe' | 'needs_review' | 'none';
};

// --- helpers ---

/** Resolve IANA zone: event field → hub default → app default. */
export function resolveEventTimezone(
  event: { timezone?: string | null },
  hubTimezone?: string | null
): string {
  const eventTz = event.timezone?.trim();
  if (eventTz) return eventTz;
  const hubTz = hubTimezone?.trim();
  if (hubTz) return hubTz;
  return DEFAULT_TIMED_ZONE;
}

/** Hub ingest: coerce event timezone to hub timezone (festival wall-clock source of truth). */
export function coerceHubEventTimezone(
  timezone: string | null | undefined,
  hubTimezone: string | null | undefined
): { timezone: string; wasOverwritten: boolean } {
  const hubTz = hubTimezone?.trim();
  if (!hubTz) {
    return {
      timezone: timezone?.trim() || DEFAULT_TIMED_ZONE,
      wasOverwritten: false,
    };
  }
  const eventTz = timezone?.trim();
  if (!eventTz || eventTz !== hubTz) {
    return { timezone: hubTz, wasOverwritten: Boolean(eventTz && eventTz !== hubTz) };
  }
  return { timezone: hubTz, wasOverwritten: false };
}

/** UTC instant → wall-clock string for Google Calendar API (no offset suffix). */
export function utcInstantToWallClockDateTime(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone: 'utc' })
    .setZone(zone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

/** Civil day key (YYYY-MM-DD) in the given IANA zone. */
export function civilDayKeyInZone(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(zone).toFormat('yyyy-MM-dd');
}

/** Format a civil day header in the given zone, e.g. "Monday, June 22". */
export function formatCivilDayHeader(ymd: string, zone: string): string {
  return DateTime.fromISO(ymd, { zone }).toFormat('EEEE, MMMM d');
}

/** True when normalized temporal fields match what is already stored. */
export function storedTemporalEquals(
  existing: EventTemporalRow,
  normalized: NormalizedEventTemporal
): boolean {
  const existingKind =
    existing.temporalKind === TEMPORAL_KIND.TIMED || existing.temporalKind === TEMPORAL_KIND.ALL_DAY
      ? existing.temporalKind
      : inferTemporalKindFromLegacy(existing.timezone);

  const allDayStartEqual =
    (existing.allDayStartDate?.getTime() ?? null) === (normalized.allDayStartDate?.getTime() ?? null);
  const allDayEndEqual =
    (existing.allDayEndDate?.getTime() ?? null) === (normalized.allDayEndDate?.getTime() ?? null);

  return (
    existingKind === normalized.temporalKind &&
    existing.start.getTime() === normalized.start.getTime() &&
    existing.end.getTime() === normalized.end.getTime() &&
    (existing.timezone?.trim() || null) === (normalized.timezone?.trim() || null) &&
    allDayStartEqual &&
    allDayEndEqual
  );
}

/**
 * Repair hub timed event: reinterpret wall-clock from the stored (possibly wrong) zone
 * into the hub zone, then re-normalize.
 */
export function repairHubTimedTemporal(
  event: EventTemporalRow,
  hubTimezone: string,
  sourceZone?: string | null
): NormalizedEventTemporal {
  const fromZone = sourceZone?.trim() || event.timezone?.trim() || DEFAULT_TIMED_ZONE;
  const startWall = DateTime.fromJSDate(event.start, { zone: 'utc' })
    .setZone(fromZone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const endWall = DateTime.fromJSDate(event.end, { zone: 'utc' })
    .setZone(fromZone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");

  return normalizeEventForWrite({
    temporalKind: TEMPORAL_KIND.TIMED,
    start: startWall,
    end: endWall,
    timezone: hubTimezone,
  });
}

export function isAllDayEvent(event: {
  temporalKind?: string | null;
  timezone?: string | null;
}): boolean {
  if (event.temporalKind === TEMPORAL_KIND.ALL_DAY) return true;
  if (event.temporalKind === TEMPORAL_KIND.TIMED) return false;
  return event.timezone == null || String(event.timezone).trim() === '';
}

export function inferTemporalKindFromLegacy(timezone: string | null | undefined): TemporalKind {
  if (timezone == null || String(timezone).trim() === '') {
    return TEMPORAL_KIND.ALL_DAY;
  }
  return TEMPORAL_KIND.TIMED;
}

export function formatYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function civilDateFromUtcInstant(d: Date): Date {
  return parseYmdToUtcDate(formatYmdUtc(d));
}

export function allDayInstantsFromCivilDates(startYmd: string, endYmdInclusive: string): {
  start: Date;
  end: Date;
} {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmdInclusive.split('-').map(Number);
  return {
    start: new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0, 0)),
    end: new Date(Date.UTC(ey, em - 1, ed, 22, 0, 0, 0)),
  };
}

export function violatesAllDayStorageContract(start: Date, end: Date): boolean {
  const okStart =
    start.getUTCHours() === 12 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0;
  const okEnd =
    end.getUTCHours() === 22 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0;
  return !(okStart && okEnd);
}

function isDateOnlyString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function hasTimeInString(s: string): boolean {
  return /T\d{1,2}:\d{2}/.test(s) || /\d{1,2}:\d{2}/.test(s);
}

/** Midnight UTC on civil day — likely bad ALL_DAY ingest */
function looksLikeMidnightUtcIngest(start: Date, end: Date, kind: TemporalKind): boolean {
  if (kind !== TEMPORAL_KIND.ALL_DAY) return false;
  const startMid =
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0;
  const endMid =
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0;
  return startMid || endMid;
}

function parseTimedToUtc(start: string, end: string, zone: string): { start: Date; end: Date } {
  const z = zone.trim() || DEFAULT_TIMED_ZONE;

  const parseOne = (value: string): DateTime => {
    const trimmed = value.trim();
    if (trimmed.includes('Z') || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
      const dt = DateTime.fromISO(trimmed, { setZone: true });
      if (!dt.isValid) throw new Error(`Invalid datetime: ${value}`);
      return dt.toUTC();
    }
    if (isDateOnlyString(trimmed)) {
      const dt = DateTime.fromISO(`${trimmed}T00:00:00`, { zone: z });
      if (!dt.isValid) throw new Error(`Invalid date: ${value}`);
      return dt.toUTC();
    }
    // datetime-local: no offset — interpret in event zone
    const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    const dt = DateTime.fromISO(normalized, { zone: z });
    if (!dt.isValid) throw new Error(`Invalid datetime: ${value}`);
    return dt.toUTC();
  };

  const s = parseOne(start);
  const e = parseOne(end);
  return { start: s.toJSDate(), end: e.toJSDate() };
}

// --- normalize / project ---

export function normalizeEventForWrite(input: EventTemporalInput): NormalizedEventTemporal {
  const kind =
    input.temporalKind ?? inferTemporalKindFromLegacy(input.timezone);

  if (kind === TEMPORAL_KIND.ALL_DAY) {
    const startYmd = isDateOnlyString(input.start)
      ? input.start.trim()
      : formatYmdUtc(new Date(input.start));
    const endYmd = isDateOnlyString(input.end)
      ? input.end.trim()
      : formatYmdUtc(new Date(input.end));

    const { start, end } = allDayInstantsFromCivilDates(startYmd, endYmd);

    if (end <= start) {
      throw new Error('End date must be after start date');
    }

    return {
      temporalKind: TEMPORAL_KIND.ALL_DAY,
      start,
      end,
      timezone: null,
      allDayStartDate: parseYmdToUtcDate(startYmd),
      allDayEndDate: parseYmdToUtcDate(endYmd),
    };
  }

  const zone = (input.timezone?.trim() || DEFAULT_TIMED_ZONE);
  const { start, end } = parseTimedToUtc(input.start, input.end, zone);

  if (end <= start) {
    throw new Error('End date must be after start date');
  }

  return {
    temporalKind: TEMPORAL_KIND.TIMED,
    start,
    end,
    timezone: zone,
    allDayStartDate: null,
    allDayEndDate: null,
  };
}

/** Build canonical fields from a DB row (for audit/repair/backfill). */
export function projectRepairFromLegacyRow(event: EventTemporalRow): RepairProjection {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const kind =
    event.temporalKind === TEMPORAL_KIND.TIMED || event.temporalKind === TEMPORAL_KIND.ALL_DAY
      ? (event.temporalKind as TemporalKind)
      : inferTemporalKindFromLegacy(event.timezone);

  let normalized: NormalizedEventTemporal;

  if (kind === TEMPORAL_KIND.TIMED) {
    const zone = event.timezone?.trim() || DEFAULT_TIMED_ZONE;
    normalized = {
      temporalKind: TEMPORAL_KIND.TIMED,
      start,
      end,
      timezone: zone,
      allDayStartDate: null,
      allDayEndDate: null,
    };
  } else {
    const startYmd =
      event.allDayStartDate != null
        ? formatYmdUtc(new Date(event.allDayStartDate))
        : formatYmdUtc(start);
    const endYmd =
      event.allDayEndDate != null
        ? formatYmdUtc(new Date(event.allDayEndDate))
        : formatYmdUtc(end);

    const instants = allDayInstantsFromCivilDates(startYmd, endYmd);
    normalized = {
      temporalKind: TEMPORAL_KIND.ALL_DAY,
      start: instants.start,
      end: instants.end,
      timezone: null,
      allDayStartDate: parseYmdToUtcDate(startYmd),
      allDayEndDate: parseYmdToUtcDate(endYmd),
    };
  }

  const storageStartDiffers = normalized.start.getTime() !== start.getTime();
  const storageEndDiffers = normalized.end.getTime() !== end.getTime();
  const violatesContract =
    kind === TEMPORAL_KIND.ALL_DAY && violatesAllDayStorageContract(start, end);
  const midnightIngest = looksLikeMidnightUtcIngest(start, end, kind);

  const needsStorageRepair =
    storageStartDiffers || storageEndDiffers || violatesContract;
  const needsReview = midnightIngest;
  const exportSemanticsChange = kind === TEMPORAL_KIND.TIMED;

  let repairBucket: RepairProjection['repairBucket'] = 'none';
  if (needsReview) {
    repairBucket = 'needs_review';
  } else if (needsStorageRepair) {
    repairBucket = 'auto_safe';
  }

  return {
    ...normalized,
    needsStorageRepair,
    needsReview,
    exportSemanticsChange,
    repairBucket,
  };
}

// --- display ---

export function formatForDisplay(
  date: Date | string,
  event: Pick<Event, 'temporalKind' | 'timezone'>,
  isEndDate = false
): string {
  const isAllDay = isAllDayEvent(event);
  const d = new Date(date);
  if (isAllDay) {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    const utcDate = new Date(year, month, day);
    return format(utcDate, 'PP');
  }
  const zone = resolveEventTimezone(event);
  const dt = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(zone);
  if (isEndDate) {
    return dt.toFormat('h:mm a ZZZZ');
  }
  return dt.toFormat('ccc, LLL d · h:mm a ZZZZ');
}

export function isEventPast(event: { end: Date | string }): boolean {
  const end = new Date(event.end);
  return end < startOfDay(new Date());
}

// --- FullCalendar ---

export function toFullCalendarEvent(event: Event) {
  const isAllDay = isAllDayEvent(event);
  let startDate =
    typeof event.start === 'string' ? event.start : event.start.toISOString();
  let endDate = typeof event.end === 'string' ? event.end : event.end.toISOString();

  if (isAllDay) {
    const endDateObj = new Date(endDate);
    const endYear = endDateObj.getUTCFullYear();
    const endMonth = endDateObj.getUTCMonth();
    const endDay = endDateObj.getUTCDate();
    const exclusiveEndDate = new Date(Date.UTC(endYear, endMonth, endDay + 1, 12, 0, 0, 0));
    endDate = exclusiveEndDate.toISOString();
  }

  return {
    id: event.id,
    title: event.title,
    start: startDate,
    end: endDate,
    allDay: isAllDay,
    url: event.url || undefined,
    extendedProps: {
      description: event.description,
      location: event.location,
      source: event.source,
      timezone: event.timezone,
      temporalKind: event.temporalKind,
    },
  };
}

// --- Google ---

export function toGoogleCalendarDate(date: Date): string {
  return formatYmdUtc(date).replace(/-/g, '');
}

export function toGoogleCalendarPayload(event: EventTemporalRow & { title?: string }): GoogleCalendarPayload {
  const isAllDay = isAllDayEvent(event as Pick<Event, 'temporalKind' | 'timezone'>);

  if (isAllDay) {
    const startYmd =
      event.allDayStartDate != null
        ? formatYmdUtc(new Date(event.allDayStartDate))
        : formatYmdUtc(new Date(event.start));
    const endYmd =
      event.allDayEndDate != null
        ? formatYmdUtc(new Date(event.allDayEndDate))
        : formatYmdUtc(new Date(event.end));

    const [ey, em, ed] = endYmd.split('-').map(Number);
    const exclusiveEnd = formatYmdUtc(new Date(Date.UTC(ey, em - 1, ed + 1)));

    return {
      start: { date: startYmd },
      end: { date: exclusiveEnd },
    };
  }

  const zone = resolveEventTimezone(event);
  const start = new Date(event.start);
  const end = new Date(event.end);

  return {
    start: {
      dateTime: utcInstantToWallClockDateTime(start, zone),
      timeZone: zone,
    },
    end: {
      dateTime: utcInstantToWallClockDateTime(end, zone),
      timeZone: zone,
    },
  };
}

// --- iCal ---

export function toICalEvent(event: EventTemporalRow): ICalEventShape {
  const isAllDay = isAllDayEvent(event as Pick<Event, 'temporalKind' | 'timezone'>);
  const start = new Date(event.start);
  let end = new Date(event.end);

  if (isAllDay) {
    const endYear = end.getUTCFullYear();
    const endMonth = end.getUTCMonth();
    const endDay = end.getUTCDate();
    end = new Date(Date.UTC(endYear, endMonth, endDay + 1, 12, 0, 0, 0));
    return { start, end, allDay: true };
  }

  const zone = resolveEventTimezone(event);
  return {
    start: DateTime.fromJSDate(start, { zone: 'utc' }).setZone(zone),
    end: DateTime.fromJSDate(end, { zone: 'utc' }).setZone(zone),
    allDay: false,
    timezone: zone,
  };
}

// --- CSV ---

export function toCsvRow(event: Event): CsvTemporalRow {
  const isAllDay = isAllDayEvent(event);
  if (isAllDay) {
    const startYmd =
      event.allDayStartDate != null
        ? formatYmdUtc(new Date(event.allDayStartDate))
        : formatYmdUtc(new Date(event.start));
    const endYmd =
      event.allDayEndDate != null
        ? formatYmdUtc(new Date(event.allDayEndDate))
        : formatYmdUtc(new Date(event.end));
    return {
      start: startYmd,
      end: endYmd,
      timezone: '',
      all_day: 'true',
      temporal_kind: TEMPORAL_KIND.ALL_DAY,
    };
  }
  return {
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    timezone: event.timezone || DEFAULT_TIMED_ZONE,
    all_day: 'false',
    temporal_kind: TEMPORAL_KIND.TIMED,
  };
}

export function fromCsvRow(row: {
  start?: string;
  end?: string;
  timezone?: string;
  all_day?: string;
  temporal_kind?: string;
}): EventTemporalInput {
  const allDayExplicit = row.all_day?.trim().toLowerCase();
  let kind: TemporalKind | undefined;
  if (row.temporal_kind === TEMPORAL_KIND.TIMED || row.temporal_kind === TEMPORAL_KIND.ALL_DAY) {
    kind = row.temporal_kind;
  } else if (allDayExplicit === 'true' || allDayExplicit === '1' || allDayExplicit === 'yes') {
    kind = TEMPORAL_KIND.ALL_DAY;
  } else if (allDayExplicit === 'false' || allDayExplicit === '0' || allDayExplicit === 'no') {
    kind = TEMPORAL_KIND.TIMED;
  } else {
    const startHasTime = row.start ? hasTimeInString(row.start) : false;
    const endHasTime = row.end ? hasTimeInString(row.end) : false;
    kind = !startHasTime && !endHasTime ? TEMPORAL_KIND.ALL_DAY : TEMPORAL_KIND.TIMED;
  }

  return {
    temporalKind: kind,
    start: row.start || '',
    end: row.end || row.start || '',
    timezone: row.timezone,
  };
}

export function buildGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);

  const payload = toGoogleCalendarPayload(event);
  if (payload.start.date && payload.end.date) {
    const startCompact = payload.start.date.replace(/-/g, '');
    const endCompact = payload.end.date.replace(/-/g, '');
    params.set('dates', `${startCompact}/${endCompact}`);
  } else if (payload.start.dateTime && payload.end.dateTime) {
    const zone = event.timezone?.trim() || DEFAULT_TIMED_ZONE;
    const fmt = (wallClock: string) => {
      const dt = DateTime.fromISO(wallClock, { zone });
      return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    };
    params.set('dates', `${fmt(payload.start.dateTime)}/${fmt(payload.end.dateTime)}`);
  }

  if (event.location) params.set('location', event.location);
  if (event.description) params.set('details', event.description);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildGoogleCalendarSubscribeUrl(feedUrl: string): string {
  const webcalUrl = feedUrl.replace(/^https?:/, 'webcal:');
  return `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
}

/** Prisma `data` fragment for create/update from normalized temporal fields. */
export function temporalFieldsForPrisma(normalized: NormalizedEventTemporal) {
  return {
    temporalKind: normalized.temporalKind,
    start: normalized.start,
    end: normalized.end,
    timezone: normalized.timezone,
    allDayStartDate: normalized.allDayStartDate,
    allDayEndDate: normalized.allDayEndDate,
  };
}

/** Merge partial API input with existing row and normalize (PATCH). */
/** Whether an event falls within a filter date range (fully contained). */
export function eventContainedInDateRange(
  event: EventTemporalRow,
  dateRange: { start?: string; end?: string }
): boolean {
  if (!dateRange.start && !dateRange.end) return true;

  const isAllDay = isAllDayEvent(event as Pick<Event, 'temporalKind' | 'timezone'>);

  if (isAllDay) {
    const eventStartYmd =
      event.allDayStartDate != null
        ? formatYmdUtc(new Date(event.allDayStartDate))
        : formatYmdUtc(new Date(event.start));
    const eventEndYmd =
      event.allDayEndDate != null
        ? formatYmdUtc(new Date(event.allDayEndDate))
        : formatYmdUtc(new Date(event.end));

    if (dateRange.start) {
      const filterStart = dateRange.start.slice(0, 10);
      if (eventStartYmd < filterStart) return false;
    }
    if (dateRange.end) {
      const filterEnd = dateRange.end.slice(0, 10);
      if (eventEndYmd > filterEnd) return false;
    }
    return true;
  }

  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  if (dateRange.start) {
    const filterStart = new Date(dateRange.start);
    if (eventStart < filterStart) return false;
  }
  if (dateRange.end) {
    const filterEnd = new Date(dateRange.end);
    if (eventEnd > filterEnd) return false;
  }
  return true;
}

/** Normalize ingest input; hub events use hub timezone as source of truth. */
export function normalizeEventForHubIngest(
  input: EventTemporalInput,
  hubTimezone: string | null | undefined
): { normalized: NormalizedEventTemporal; timezoneOverwritten: boolean } {
  const coerced = coerceHubEventTimezone(input.timezone, hubTimezone);
  const kind = input.temporalKind ?? inferTemporalKindFromLegacy(coerced.timezone);

  const normalized = normalizeEventForWrite({
    ...input,
    temporalKind: kind,
    timezone: kind === TEMPORAL_KIND.TIMED ? coerced.timezone : null,
  });

  return { normalized, timezoneOverwritten: coerced.wasOverwritten };
}

export function mergeAndNormalizeTemporal(
  input: Partial<EventTemporalInput>,
  existing: EventTemporalRow
): NormalizedEventTemporal {
  const kind =
    input.temporalKind ??
    (existing.temporalKind === TEMPORAL_KIND.TIMED || existing.temporalKind === TEMPORAL_KIND.ALL_DAY
      ? (existing.temporalKind as TemporalKind)
      : inferTemporalKindFromLegacy(input.timezone !== undefined ? input.timezone : existing.timezone));

  const tz =
    input.timezone !== undefined
      ? input.timezone
      : existing.timezone;

  let startStr: string;
  let endStr: string;

  if (kind === TEMPORAL_KIND.ALL_DAY) {
    startStr =
      input.start ??
      (existing.allDayStartDate != null
        ? formatYmdUtc(new Date(existing.allDayStartDate))
        : formatYmdUtc(new Date(existing.start)));
    endStr =
      input.end ??
      (existing.allDayEndDate != null
        ? formatYmdUtc(new Date(existing.allDayEndDate))
        : formatYmdUtc(new Date(existing.end)));
  } else {
    startStr = input.start ?? new Date(existing.start).toISOString();
    endStr = input.end ?? new Date(existing.end).toISOString();
  }

  return normalizeEventForWrite({
    temporalKind: kind,
    start: startStr,
    end: endStr,
    timezone: tz,
  });
}
