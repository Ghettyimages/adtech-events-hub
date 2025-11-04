'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Event } from '@prisma/client';
import { formatEventForCalendar } from '@/lib/events';
import EventCard from './EventCard';
import EventList from './EventList';

export default function Calendar() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
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

  const handleExportList = () => {
    if (!events.length) {
      return;
    }

    const headers = ['Title', 'Start', 'End', 'Location', 'Timezone', 'Source', 'URL', 'Description'];

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const rows = events.map((event) => {
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
  const hasEvents = events.length > 0;

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
          disabled={!hasEvents}
          className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 ${
            hasEvents
              ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
              : 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-500'
          }`}
        >
          Export list (CSV)
        </button>
      </div>

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
        <EventList events={events} onSelect={(event) => setSelectedEvent(event)} />
      )}

      {selectedEvent && (
        <EventCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
