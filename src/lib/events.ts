import { Event } from '@prisma/client';
import { format } from 'date-fns';

/**
 * Converts a Date to Google Calendar format (UTC): YYYYMMDDTHHmmssZ
 */
export function toGoogleCalendarDate(date: Date): string {
  return format(date, "yyyyMMdd'T'HHmmss'Z'");
}

/**
 * Builds a Google Calendar event URL
 */
export function buildGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  
  const startUtc = toGoogleCalendarDate(new Date(event.start));
  const endUtc = toGoogleCalendarDate(new Date(event.end));
  params.set('dates', `${startUtc}/${endUtc}`);
  
  if (event.location) {
    params.set('location', event.location);
  }
  
  if (event.description) {
    params.set('details', event.description);
  }
  
  if (event.timezone) {
    params.set('ctz', event.timezone);
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
    url: event.url || undefined,
    extendedProps: {
      description: event.description,
      location: event.location,
      source: event.source,
      timezone: event.timezone,
    },
  };
}
