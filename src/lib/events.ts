import { Event } from '@prisma/client';
import { format } from 'date-fns';

/**
 * Formats a date for display, handling all-day events correctly
 * For all-day events (timezone is null), extracts UTC date components to avoid timezone shifts
 * All-day events are stored with fixed UTC times (start: 12:00 UTC, end: 22:00 UTC) on inclusive calendar days
 * For timed events, formats using local time
 * @param date - The date to format
 * @param isAllDay - Whether this is an all-day event
 * @param isEndDate - Whether this is an end date (unused for all-day events, kept for API compatibility)
 */
export function formatEventDateForDisplay(date: Date | string, isAllDay: boolean, isEndDate: boolean = false): string {
  const d = new Date(date);
  if (isAllDay) {
    // For all-day events, extract UTC date components to avoid timezone shifts
    // All-day events are stored at UTC noon
    let year = d.getUTCFullYear();
    let month = d.getUTCMonth();
    let day = d.getUTCDate();

    // Create a date in local timezone with UTC components for formatting
    const utcDate = new Date(year, month, day);
    return format(utcDate, 'PP');
  } else {
    // For timed events, format using local time
    return format(d, 'PP');
  }
}

/**
 * Converts a Date to Google Calendar all-day format: YYYYMMDD
 * Uses UTC date components to avoid timezone shifts
 */
export function toGoogleCalendarDate(date: Date): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Builds a Google Calendar event URL for all-day events
 */
export function buildGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  
  // Format as all-day events (date only, no time)
  const startDate = toGoogleCalendarDate(new Date(event.start));
  const endDate = toGoogleCalendarDate(new Date(event.end));
  params.set('dates', `${startDate}/${endDate}`);
  
  if (event.location) {
    params.set('location', event.location);
  }
  
  if (event.description) {
    params.set('details', event.description);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds a webcal URL for Google Calendar subscription
 */
export function buildGoogleCalendarSubscribeUrl(feedUrl: string): string {
  // Convert http(s):// to webcal://
  const webcalUrl = feedUrl.replace(/^https?:/, 'webcal:');
  return `https://www.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`;
}

/**
 * Formats an event for FullCalendar
 * Events are all-day if they don't have a timezone (default behavior)
 * Events with a timezone have specific times and should display times
 */
export function formatEventForCalendar(event: Event) {
  // Handle both Date objects and ISO string dates
  const startDate = typeof event.start === 'string' ? event.start : event.start.toISOString();
  const endDate = typeof event.end === 'string' ? event.end : event.end.toISOString();
  
  // If timezone is null/undefined, it's an all-day event
  // If timezone is set, it has specific times
  const isAllDay = !event.timezone;
  
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
    },
  };
}
