'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Event } from '@prisma/client';
import {
  addDays,
  endOfDay,
  endOfMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { formatEventForCalendar } from '@/lib/events';
import EventCard from './EventCard';
import EventList from './EventList';

type DateFilterOption = 'upcoming' | 'next_7_days' | 'next_30_days' | 'this_month' | 'custom';

export default function Calendar() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [filterOption, setFilterOption] = useState<DateFilterOption>('upcoming');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const calendarRef = useRef<FullCalendar>(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/events');
      if (!res.ok) throw new Error('Failed to fetch events');
      const data = await res.json();
      setEvents(data.events);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectEventById = (eventId: string) => {
    const event = events.find((e) => e.id === eventId);
    if (event) {
      setSelectedEvent(event);
    }
  };

  const handleEventClick = (info: any) => {
    info.jsEvent.preventDefault();
    selectEventById(info.event.id);
  };

  const filteredEvents = useMemo(() => {
    if (!events.length) {
      return [];
    }

    const today = startOfDay(new Date());

    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    switch (filterOption) {
      case 'upcoming':
        rangeStart = today;
        break;
      case 'next_7_days':
        rangeStart = today;
        rangeEnd = endOfDay(addDays(today, 6));
        break;
      case 'next_30_days':
        rangeStart = today;
        rangeEnd = endOfDay(addDays(today, 29));
        break;
      case 'this_month':
        rangeStart = startOfMonth(today);
        rangeEnd = endOfMonth(today);
        break;
      case 'custom':
        rangeStart = customStart ? startOfDay(new Date(customStart)) : null;
        rangeEnd = customEnd ? endOfDay(new Date(customEnd)) : null;
        if (
          rangeStart &&
          rangeEnd &&
          (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart > rangeEnd)
        ) {
          return [];
        }
        break;
      default:
        break;
    }

    return events.filter((event) => {
      const eventStart = new Date(event.start);
      const eventEndCandidate = event.end ? new Date(event.end) : eventStart;

      if (Number.isNaN(eventStart.getTime())) {
        return false;
      }

      const eventEnd = Number.isNaN(eventEndCandidate.getTime()) ? eventStart : eventEndCandidate;

      if (rangeStart && rangeEnd) {
        return (
          isWithinInterval(eventStart, { start: rangeStart, end: rangeEnd }) ||
          isWithinInterval(eventEnd, { start: rangeStart, end: rangeEnd }) ||
          (eventStart <= rangeStart && eventEnd >= rangeEnd)
        );
      }

      if (rangeStart && !rangeEnd) {
        return eventEnd >= rangeStart;
      }

      if (!rangeStart && rangeEnd) {
        return eventStart <= rangeEnd;
      }

      return true;
    });
  }, [events, filterOption, customStart, customEnd]);

  const exportableEvents = viewMode === 'list' ? filteredEvents : events;
  const hasExportableEvents = exportableEvents.length > 0;
  const isCustomRangeInvalid = useMemo(() => {
    if (filterOption !== 'custom' || !customStart || !customEnd) {
      return false;
    }

    const start = new Date(customStart);
    const end = new Date(customEnd);

    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end;
  }, [filterOption, customStart, customEnd]);

  const handleExportList = () => {
    if (!exportableEvents.length) {
      return;
    }

    const headers = ['Title', 'Start', 'End', 'Location', 'Timezone', 'Source', 'URL', 'Description'];

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const rows = exportableEvents.map((event) => {
      const start = new Date(event.start);
      const end = new Date(event.end);

      const cells = [
        event.title || '',
        Number.isNaN(start.getTime()) ? '' : start.toISOString(),
        Number.isNaN(end.getTime()) ? '' : end.toISOString(),
        event.location || '',
        event.timezone || '',
        event.source || '',
        event.url || '',
        event.description || '',
      ];

      return cells.map((cell) => escape(cell)).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `adtech-events-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formattedCalendarEvents = useMemo(() => events.map(formatEventForCalendar), [events]);
  const listEmptyStateMessage =
    filterOption === 'upcoming'
      ? 'No upcoming events are scheduled right now. Check back soon for new listings.'
      : 'No events match the selected date range. Try adjusting your filters.';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-xl text-gray-600">Loading events...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm font-medium shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`rounded-md px-4 py-2 transition ${
                viewMode === 'calendar'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              Calendar view
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded-md px-4 py-2 transition ${
                viewMode === 'list'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              List view
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportList}
            disabled={!hasExportableEvents}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 ${
              hasExportableEvents
                ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
                : 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
            }`}
          >
            Export list (CSV)
          </button>
        </div>

        {viewMode === 'list' && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor="date-filter" className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Date range
              </label>
              <select
                id="date-filter"
                value={filterOption}
                onChange={(event) => setFilterOption(event.target.value as DateFilterOption)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 sm:w-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="upcoming">All upcoming events</option>
                <option value="next_7_days">Next 7 days</option>
                <option value="next_30_days">Next 30 days</option>
                <option value="this_month">This month</option>
                <option value="custom">Custom range</option>
              </select>
            </div>

            {filterOption === 'custom' && (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex w-full flex-col gap-2 sm:w-auto">
                  <label htmlFor="custom-start" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Start date
                  </label>
                  <input
                    id="custom-start"
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto">
                  <label htmlFor="custom-end" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    End date
                  </label>
                  <input
                    id="custom-end"
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>
            )}

            {filterOption === 'custom' && isCustomRangeInvalid && (
              <p className="text-sm font-medium text-red-600 dark:text-red-400">Start date must be before end date.</p>
            )}

            <div className="text-sm text-gray-600 dark:text-gray-300">
              Showing {filteredEvents.length} event{filteredEvents.length === 1 ? '' : 's'}
            </div>
          </div>
        )}

        {viewMode === 'calendar' ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              events={formattedCalendarEvents}
              eventClick={handleEventClick}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,dayGridWeek',
              }}
              height="auto"
              eventColor="#3b82f6"
              eventDisplay="block"
              noEventsContent="No events scheduled"
            />
          </div>
        ) : (
          <EventList
            events={filteredEvents}
            onSelect={(event) => setSelectedEvent(event)}
            emptyStateMessage={listEmptyStateMessage}
          />
        )}

      {selectedEvent && (
        <EventCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
