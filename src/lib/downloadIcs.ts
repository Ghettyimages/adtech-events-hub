import type { Event } from '@prisma/client';
import ical, { ICalCalendar } from 'ical-generator';
import { addEventToICalCalendar } from '@/lib/icalEvent';

export function downloadEventIcs(
  event: Pick<Event, 'title' | 'description' | 'location' | 'url' | 'start' | 'end' | 'timezone' | 'temporalKind' | 'allDayStartDate' | 'allDayEndDate'>,
  calendarName = 'The Media Calendar'
) {
  const calendar: ICalCalendar = ical({ name: calendarName });
  addEventToICalCalendar(calendar, event);
  const icsContent = calendar.toString();
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
