'use client';

import { Event } from '@prisma/client';
import { buildGoogleCalendarUrl } from '@/lib/events';
import ical, { ICalCalendar } from 'ical-generator';

interface AddToCalendarLinkProps {
  event: Event;
}

export default function AddToCalendarLink({ event }: AddToCalendarLinkProps) {
  const googleCalUrl = buildGoogleCalendarUrl(event);

  const downloadICS = () => {
    const calendar: ICalCalendar = ical({ name: 'AdTech Event' });
    
    calendar.createEvent({
      start: new Date(event.start),
      end: new Date(event.end),
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      url: event.url || undefined,
    });

    const icsContent = calendar.toString();
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <a
        href={googleCalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
      >
        📅 Add to Google Calendar
      </a>
      <button
        onClick={downloadICS}
        className="inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
      >
        ⬇️ Download .ics
      </button>
    </div>
  );
}
