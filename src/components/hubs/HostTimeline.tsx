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
      <p className="text-tmc-muted py-8 text-center">
        No events listed yet for this host.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {byDay.map(({ day, events: dayEvents }) => (
        <section key={day.toISOString()}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-tmc-navy mb-3 border-b border-tmc-border pb-2">
            {format(day, 'EEEE, MMMM d')}
          </h3>
          <ul className="space-y-3">
            {dayEvents.map((event) => {
              const isAllDay = isAllDayEvent(event);
              return (
                <li
                  key={event.id}
                  className="flex flex-col gap-4 p-4 md:p-5 rounded-xl bg-tmc-navy text-white shadow-md border border-tmc-blue/30"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5">
                    <div className="sm:w-40 shrink-0 text-sm font-semibold text-tmc-cyan-soft">
                      {formatEventDateForDisplay(event.start, isAllDay, false)}
                    </div>
                    <div className="flex-1 min-w-0">
                      {onSelectEvent ? (
                        <button
                          type="button"
                          onClick={() => onSelectEvent(event)}
                          className="font-semibold text-lg text-white hover:text-tmc-cyan-soft text-left transition"
                        >
                          {event.title}
                        </button>
                      ) : (
                        <p className="font-semibold text-lg text-white">{event.title}</p>
                      )}
                      {event.location && (
                        <p className="text-sm text-white/75 mt-1">{event.location}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-3 border-t border-white/15">
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-white/40 bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition min-h-[44px] flex-1 sm:flex-none"
                      >
                        <span aria-hidden>↗</span>
                        View event details
                      </a>
                    )}
                    <a
                      href={buildGoogleCalendarUrl(event as unknown as Event)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-tmc-navy transition min-h-[44px] flex-1 sm:flex-none hover:opacity-90"
                      style={{ background: 'var(--hub-accent, #C9A227)' }}
                    >
                      <span aria-hidden>📅</span>
                      Add to Google Calendar
                    </a>
                    {onSelectEvent && (
                      <button
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-white/25 text-white text-sm font-semibold hover:bg-white/10 transition min-h-[44px] flex-1 sm:flex-none"
                      >
                        More info
                      </button>
                    )}
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
