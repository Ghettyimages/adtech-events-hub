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
 * Builds a Google Calendar event URL
 * For all-day events, uses date-only format with exclusive end date
 * For timed events, uses full datetime format
 */
export function buildGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  
  // Check if this is an all-day event (no timezone = all-day)
  const isAllDay = !event.timezone;
  
  if (isAllDay) {
    // Format as all-day events (date only, no time)
    // Google Calendar uses exclusive end dates, so add 1 day
    const startDate = toGoogleCalendarDate(new Date(event.start));
    const endDateObj = new Date(event.end);
    const endYear = endDateObj.getUTCFullYear();
    const endMonth = endDateObj.getUTCMonth();
    const endDay = endDateObj.getUTCDate();
    const exclusiveEnd = new Date(Date.UTC(endYear, endMonth, endDay + 1));
    const endDate = toGoogleCalendarDate(exclusiveEnd);
    params.set('dates', `${startDate}/${endDate}`);
  } else {
    // For timed events, use full ISO format (YYYYMMDDTHHmmssZ)
    const start = new Date(event.start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const end = new Date(event.end).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    params.set('dates', `${start}/${end}`);
  }
  
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
 * 
 * Note: FullCalendar uses exclusive end dates for all-day events.
 * We store inclusive end dates (e.g., Feb 21 at 22:00 UTC for Feb 18-21 event),
 * so we add one day to the end date for all-day events to display correctly.
 */
export function formatEventForCalendar(event: Event) {
  // Handle both Date objects and ISO string dates
  const startDate = typeof event.start === 'string' ? event.start : event.start.toISOString();
  let endDate = typeof event.end === 'string' ? event.end : event.end.toISOString();
  
  // If timezone is null/undefined, it's an all-day event
  // If timezone is set, it has specific times
  const isAllDay = !event.timezone;
  
  // For all-day events, FullCalendar expects exclusive end dates
  // We store inclusive end dates, so add one day to the end date for calendar display
  if (isAllDay) {
    const endDateObj = new Date(endDate);
    // Extract UTC date components and add one day
    const endYear = endDateObj.getUTCFullYear();
    const endMonth = endDateObj.getUTCMonth();
    const endDay = endDateObj.getUTCDate();
    
    // Create new date one day later at 12:00 UTC (same as start time for consistency)
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
    },
  };
}
