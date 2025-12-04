import { Event } from '@prisma/client';
import { format } from 'date-fns';

/**
 * Converts a Date to Google Calendar all-day format: YYYYMMDD
 */
export function toGoogleCalendarDate(date: Date): string {
  return format(date, 'yyyyMMdd');
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
 * Formats an event for FullCalendar as an all-day event
 */
export function formatEventForCalendar(event: Event) {
  // Handle both Date objects and ISO string dates
  const startDate = typeof event.start === 'string' ? event.start : event.start.toISOString();
  const endDate = typeof event.end === 'string' ? event.end : event.end.toISOString();
  
  return {
    id: event.id,
    title: event.title,
    start: startDate,
    end: endDate,
    allDay: true, // Mark as all-day event (no time display)
    url: event.url || undefined,
    extendedProps: {
      description: event.description,
      location: event.location,
      source: event.source,
      timezone: event.timezone,
    },
  };
}
