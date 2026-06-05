/**
 * Re-exports from @/lib/eventTemporal for backward compatibility.
 */
import type { Event } from '@prisma/client';
import {
  isEventPast,
  formatForDisplay,
  toFullCalendarEvent,
  toGoogleCalendarDate,
  buildGoogleCalendarUrl,
  buildGoogleCalendarSubscribeUrl,
  isAllDayEvent,
  TEMPORAL_KIND,
  DEFAULT_TIMED_ZONE,
} from '@/lib/eventTemporal';

export {
  isEventPast,
  toFullCalendarEvent as formatEventForCalendar,
  toGoogleCalendarDate,
  buildGoogleCalendarUrl,
  buildGoogleCalendarSubscribeUrl,
  isAllDayEvent,
};

type DisplayTemporal = {
  temporalKind?: string | null;
  timezone?: string | null;
};

export function formatEventDateForDisplay(
  date: Date | string,
  eventOrIsAllDay: DisplayTemporal | boolean,
  isEndDate = false
): string {
  const event: DisplayTemporal =
    typeof eventOrIsAllDay === 'boolean'
      ? {
          temporalKind: eventOrIsAllDay ? TEMPORAL_KIND.ALL_DAY : TEMPORAL_KIND.TIMED,
          timezone: eventOrIsAllDay ? null : DEFAULT_TIMED_ZONE,
        }
      : eventOrIsAllDay;
  return formatForDisplay(date, event, isEndDate);
}
