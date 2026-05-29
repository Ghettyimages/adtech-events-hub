'use client';

import { useMemo } from 'react';
import { format, isSameDay } from 'date-fns';
import { formatEventDateForDisplay, isAllDayEvent } from '@/lib/events';
import { buildGoogleCalendarUrl } from '@/lib/events';
import type { Event } from '@prisma/client';

export interface HubEventRow {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  start: string | Date;
  end: string | Date;
  timezone: string | null;
  temporalKind?: string | null;
  tags: string | null;
  source: string | null;
}

interface HostTimelineProps {
  events: HubEventRow[];
  onSelectEvent?: (event: HubEventRow) => void;
}

export default function HostTimeline({ events, onSelectEvent }: HostTimelineProps) {
  const byDay = useMemo(() => {
    const groups: { day: Date; events: HubEventRow[] }[] = [];
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    for (const event of sorted) {
      const day = new Date(event.start);
      day.setHours(0, 0, 0, 0);
      const last = groups[groups.length - 1];
      if (last && isSameDay(last.day, day)) {
        last.events.push(event);
      } else {
        groups.push({ day, events: [event] });
      }
    }
    return groups;
  }, [events]);

  if (events.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 py-8 text-center">
        No events listed yet for this host.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {byDay.map(({ day, events: dayEvents }) => (
        <section key={day.toISOString()}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
            {format(day, 'EEEE, MMMM d')}
          </h3>
          <ul className="space-y-3">
            {dayEvents.map((event) => {
              const isAllDay = isAllDayEvent(event);
              return (
                <li
                  key={event.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                >
                  <div className="sm:w-36 shrink-0 text-sm font-medium text-gray-600 dark:text-gray-300">
                    {formatEventDateForDisplay(event.start, isAllDay, false)}
                  </div>
                  <div className="flex-1 min-w-0">
                    {onSelectEvent ? (
                      <button
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        className="font-semibold text-gray-900 dark:text-white hover:text-tmc-blue text-left"
                      >
                        {event.title}
                      </button>
                    ) : (
                      <p className="font-semibold text-gray-900 dark:text-white">{event.title}</p>
                    )}
                    {event.location && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{event.location}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-tmc-blue hover:underline min-h-[44px] flex items-center"
                      >
                        Details
                      </a>
                    )}
                    <a
                      href={buildGoogleCalendarUrl(event as unknown as Event)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-tmc-blue hover:underline min-h-[44px] flex items-center"
                    >
                      + Cal
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
