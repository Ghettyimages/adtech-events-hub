import type { Event } from '@prisma/client';
import type { ICalCalendar } from 'ical-generator';
import { toICalEvent } from '@/lib/eventTemporal';

export function addEventToICalCalendar(
  calendar: ICalCalendar,
  event: Pick<
    Event,
    'title' | 'description' | 'location' | 'url' | 'start' | 'end' | 'timezone' | 'temporalKind' | 'allDayStartDate' | 'allDayEndDate'
  >
) {
  const { start, end, allDay, timezone } = toICalEvent(event);
  calendar.createEvent({
    start,
    end,
    allDay,
    timezone: allDay ? undefined : timezone,
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    url: event.url || undefined,
  });
}
