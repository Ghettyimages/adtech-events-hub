/**
 * Re-exports from @/lib/eventTemporal for backward compatibility.
 */
import {
  isEventPast,
  formatForDisplay,
  toFullCalendarEvent,
  toGoogleCalendarDate,
  buildGoogleCalendarUrl,
  buildGoogleCalendarSubscribeUrl,
  isAllDayEvent,
  TEMPORAL_KIND,
} from '@/lib/eventTemporal';

export {
  isEventPast,
  toFullCalendarEvent as formatEventForCalendar,
  toGoogleCalendarDate,
  buildGoogleCalendarUrl,
  buildGoogleCalendarSubscribeUrl,
  isAllDayEvent,
};

/** @deprecated Use formatForDisplay(date, event) with full event row when possible */
export function formatEventDateForDisplay(
  date: Date | string,
  isAllDay: boolean,
  _isEndDate = false
): string {
  return formatForDisplay(date, {
    temporalKind: isAllDay ? TEMPORAL_KIND.ALL_DAY : TEMPORAL_KIND.TIMED,
    timezone: isAllDay ? null : 'America/New_York',
  });
}
