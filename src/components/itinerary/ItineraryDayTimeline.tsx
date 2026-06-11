'use client';

import { useMemo, useState } from 'react';
import { formatCivilDayHeader } from '@/lib/eventTemporal';
import { formatEventDateForDisplay } from '@/lib/events';
import type { ItineraryEventRow } from '@/lib/itineraryConstants';
import { ITINERARY_LIMITS } from '@/lib/itineraryConstants';
import {
  groupEventsByDay,
  layoutTimedEvents,
  partitionItineraryEvents,
} from '@/lib/itineraryTimeline';

interface ItineraryDayTimelineProps {
  events: ItineraryEventRow[];
  displayTimezone: string;
  onSelectEvent?: (event: ItineraryEventRow) => void;
  initialDayKey?: string | null;
}

export default function ItineraryDayTimeline({
  events,
  displayTimezone,
  onSelectEvent,
  initialDayKey,
}: ItineraryDayTimelineProps) {
  const [viewMode, setViewMode] = useState<'timeline' | 'agenda'>('agenda');
  const [overflowDay, setOverflowDay] = useState<string | null>(null);

  const byDay = useMemo(
    () => groupEventsByDay(events, displayTimezone),
    [events, displayTimezone]
  );

  const defaultDay =
    initialDayKey ?? byDay[0]?.dayKey ?? null;

  const [selectedDay, setSelectedDay] = useState<string | null>(defaultDay);

  if (events.length === 0) {
    return (
      <p className="text-tmc-muted py-8 text-center">
        No events in this itinerary yet. Add events, hosts, or hubs from Festival Hubs.
      </p>
    );
  }

  const activeDay = selectedDay ?? byDay[0]?.dayKey;
  const dayGroup = byDay.find((g) => g.dayKey === activeDay);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {byDay.map(({ dayKey }) => (
            <button
              key={dayKey}
              type="button"
              onClick={() => setSelectedDay(dayKey)}
              className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[44px] ${
                activeDay === dayKey
                  ? 'bg-tmc-navy text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              {formatCivilDayHeader(dayKey, displayTimezone)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode('agenda')}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[44px] border transition ${
              viewMode === 'agenda'
                ? 'bg-tmc-navy text-white border-tmc-navy'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-2 rounded-lg text-sm font-medium min-h-[44px] border transition ${
              viewMode === 'timeline'
                ? 'bg-tmc-navy text-white border-tmc-navy'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            Timeline
          </button>
        </div>
      </div>

      {dayGroup && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-tmc-navy mb-3 border-b border-tmc-border pb-2">
            {formatCivilDayHeader(dayGroup.dayKey, displayTimezone)}
          </h3>

          {viewMode === 'agenda' ? (
            <AgendaView
              events={dayGroup.events}
              displayTimezone={displayTimezone}
              onSelectEvent={onSelectEvent}
            />
          ) : (
            <TimelineView
              events={dayGroup.events}
              displayTimezone={displayTimezone}
              dayKey={dayGroup.dayKey}
              onSelectEvent={onSelectEvent}
              overflowDay={overflowDay}
              onOverflow={(day) => setOverflowDay(day)}
            />
          )}
        </section>
      )}
    </div>
  );
}

function AgendaView({
  events,
  displayTimezone,
  onSelectEvent,
}: {
  events: ItineraryEventRow[];
  displayTimezone: string;
  onSelectEvent?: (event: ItineraryEventRow) => void;
}) {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  return (
    <ul className="space-y-3">
      {sorted.map((event) => (
        <li
          key={event.id}
          className="p-4 rounded-xl bg-tmc-navy text-white border border-tmc-blue/30"
        >
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
            <div className="text-sm font-semibold text-tmc-cyan-soft sm:w-40 shrink-0">
              {formatEventDateForDisplay(event.start, event, false)}
            </div>
            <div className="flex-1 min-w-0">
              {onSelectEvent ? (
                <button
                  type="button"
                  onClick={() => onSelectEvent(event)}
                  className="font-semibold text-left hover:text-tmc-cyan-soft"
                >
                  {event.title}
                </button>
              ) : (
                <p className="font-semibold">{event.title}</p>
              )}
              {event.hostName && (
                <p className="text-sm text-white/60">{event.hostName}</p>
              )}
              {event.location && (
                <p className="text-sm text-white/75">{event.location}</p>
              )}
              {!event.gcalSyncable && (
                <p className="text-xs text-amber-200/80 mt-1">Date only — not synced to Google Calendar</p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TimelineView({
  events,
  displayTimezone,
  dayKey,
  onSelectEvent,
  overflowDay,
  onOverflow,
}: {
  events: ItineraryEventRow[];
  displayTimezone: string;
  dayKey: string;
  onSelectEvent?: (event: ItineraryEventRow) => void;
  overflowDay: string | null;
  onOverflow: (day: string | null) => void;
}) {
  const { allDay, timed } = partitionItineraryEvents(events);
  const layout = useMemo(() => layoutTimedEvents(timed), [timed]);
  const visible = layout.filter((l) => !l.hidden);
  const hidden = layout.filter((l) => l.hidden);
  const maxCols = Math.min(
    Math.max(...layout.map((l) => l.totalColumns), 1),
    ITINERARY_LIMITS.MAX_VISIBLE_OVERLAP_COLUMNS
  );

  return (
    <div className="space-y-3">
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50">
          <span className="text-xs font-semibold uppercase text-amber-800 dark:text-amber-200 w-full">
            All day
          </span>
          {allDay.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onSelectEvent?.(event)}
              className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 text-sm border"
            >
              {event.title}
            </button>
          ))}
        </div>
      )}

      <div
        className="relative rounded-xl border border-tmc-border bg-white dark:bg-gray-900"
        style={{ minHeight: 480 }}
      >
        {visible.map(({ event, column, topPercent, heightPercent }) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent?.(event)}
            className="absolute rounded-lg bg-tmc-navy text-white text-left p-2 text-xs shadow border border-white/20 overflow-hidden hover:brightness-110 transition"
            style={{
              top: `${topPercent}%`,
              height: `${heightPercent}%`,
              left: `${(column / maxCols) * 100}%`,
              width: `${(1 / maxCols) * 100 - 1}%`,
              minHeight: ITINERARY_LIMITS.MIN_EVENT_BLOCK_HEIGHT_PX,
            }}
            aria-label={`${event.title}, ${formatEventDateForDisplay(event.start, event, false)}`}
          >
            <span className="font-semibold block truncate">{event.title}</span>
            <span className="text-tmc-cyan-soft block">
              {formatEventDateForDisplay(event.start, event, false)}
            </span>
          </button>
        ))}
      </div>

      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => onOverflow(overflowDay === dayKey ? null : dayKey)}
          className="text-sm text-tmc-navy font-semibold underline"
        >
          +{hidden.length} more overlapping
        </button>
      )}

      {overflowDay === dayKey && hidden.length > 0 && (
        <ul className="space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
          {hidden.map(({ event }) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSelectEvent?.(event)}
                className="text-left w-full text-sm"
              >
                <span className="font-medium">{event.title}</span>
                <span className="text-tmc-muted ml-2">
                  {formatEventDateForDisplay(event.start, event, false)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {timed.length === 0 && allDay.length === 0 && (
        <p className="text-tmc-muted text-center py-6">No events this day.</p>
      )}
    </div>
  );
}
