'use client';

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
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
import { PREDEFINED_TAGS } from '@/lib/extractor/tagExtractor';
import EventCard from './EventCard';
import EventList from './EventList';
import SubscribeModal from './SubscribeModal';

type DateFilterOption = 'upcoming' | 'next_7_days' | 'next_30_days' | 'this_month' | 'custom';

export default function Calendar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [filterOption, setFilterOption] = useState<DateFilterOption>('upcoming');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [feedToken, setFeedToken] = useState<string | null>(null);

  // Filter state from URL params
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get('tags')?.split(',').filter(Boolean) || []
  );
  const [filterCountry, setFilterCountry] = useState<string>(
    searchParams.get('country') || ''
  );
  const [filterRegion, setFilterRegion] = useState<string>(
    searchParams.get('region') || ''
  );
  const [filterCity, setFilterCity] = useState<string>(
    searchParams.get('city') || ''
  );
  const [sortOption, setSortOption] = useState<string>(
    searchParams.get('sort') || 'date'
  );

  const calendarRef = useRef<FullCalendar>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedTags.length > 0) {
        params.set('tags', selectedTags.join(','));
      }
      if (filterCountry) {
        params.set('country', filterCountry);
      }
      if (filterRegion) {
        params.set('region', filterRegion);
      }
      if (filterCity) {
        params.set('city', filterCity);
      }
      if (sortOption) {
        params.set('sort', sortOption);
      }

      const queryString = params.toString();
      const url = queryString ? `/api/events?${queryString}` : '/api/events';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch events');
      const data = await res.json();
      setEvents(data.events);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedTags, filterCountry, filterRegion, filterCity, sortOption]);

  // Update URL when filters change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (selectedTags.length > 0) {
        params.set('tags', selectedTags.join(','));
      }
      if (filterCountry) {
        params.set('country', filterCountry);
      }
      if (filterRegion) {
        params.set('region', filterRegion);
      }
      if (filterCity) {
        params.set('city', filterCity);
      }
      if (sortOption && sortOption !== 'date') {
        params.set('sort', sortOption);
      }

      const queryString = params.toString();
      const newUrl = queryString ? `?${queryString}` : window.location.pathname;
      router.replace(newUrl, { scroll: false });
    }, 300); // Debounce URL updates

    return () => clearTimeout(timer);
  }, [selectedTags, filterCountry, filterRegion, filterCity, sortOption, router]);

  // Fetch events when filters change
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Fetch feedToken when authenticated
  useEffect(() => {
    if (status === 'authenticated' && session) {
      fetch('/api/subscriptions/status')
        .then((res) => res.json())
        .then((data) => {
          if (data.feedToken) {
            setFeedToken(data.feedToken);
          }
        })
        .catch((error) => console.error('Error fetching feed token:', error));
    }
  }, [status, session]);

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

  // Get unique countries and regions from events for filter options
  const availableCountries = useMemo(() => {
    const countries = new Set<string>();
    events.forEach((event) => {
      if (event.country) countries.add(event.country);
    });
    return Array.from(countries).sort();
  }, [events]);

  const availableRegions = useMemo(() => {
    const regions = new Set<string>();
    events.forEach((event) => {
      if (event.region) regions.add(event.region);
    });
    return Array.from(regions).sort();
  }, [events]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  const clearFilters = () => {
    setSelectedTags([]);
    setFilterCountry('');
    setFilterRegion('');
    setFilterCity('');
    setSortOption('date');
  };

  const hasActiveFilters = selectedTags.length > 0 || filterCountry || filterRegion || filterCity || (sortOption && sortOption !== 'date');

  // Get filter description for subscription
  const getFilterDescription = () => {
    const parts: string[] = [];
    if (selectedTags.length > 0) {
      parts.push(`Tags: ${selectedTags.join(', ')}`);
    }
    if (filterCountry) parts.push(`Country: ${filterCountry}`);
    if (filterRegion) parts.push(`Region: ${filterRegion}`);
    if (filterCity) parts.push(`City: ${filterCity}`);
    return parts.join(' • ') || 'Current filter';
  };

  const handleSubscribeToFilter = async () => {
    const filter = {
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      country: filterCountry || undefined,
      region: filterRegion || undefined,
      city: filterCity || undefined,
    };

    const res = await fetch('/api/subscriptions/custom/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter,
        acceptTerms: true,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setFeedToken(data.feedToken || feedToken);
      setShowSubscribeModal(false);
    } else {
      const error = await res.json();
      throw new Error(error.error || 'Failed to subscribe to filter');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-xl text-gray-600">Loading events...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        {/* Filter UI */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h2>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="mb-4 space-y-3">
              <div className="flex flex-wrap gap-2">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                >
                  Tag: {tag}
                  <button
                    onClick={() => handleTagToggle(tag)}
                    className="hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              ))}
              {filterCountry && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  Country: {filterCountry}
                  <button
                    onClick={() => setFilterCountry('')}
                    className="hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              )}
              {filterRegion && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  Region: {filterRegion}
                  <button
                    onClick={() => setFilterRegion('')}
                    className="hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              )}
              {filterCity && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  City: {filterCity}
                  <button
                    onClick={() => setFilterCity('')}
                    className="hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              )}
              {sortOption && sortOption !== 'date' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  Sort: {sortOption}
                  <button
                    onClick={() => setSortOption('date')}
                    className="hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              )}
              </div>
              
              {/* Subscribe to Filter button */}
              {status === 'authenticated' && (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setShowSubscribeModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Subscribe to this Filter
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Get a calendar feed that automatically updates with events matching these filters
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Tags filter */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                Tags
              </label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-gray-300 p-2 dark:border-gray-700">
                {PREDEFINED_TAGS.map((tag) => (
                  <label key={tag} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag)}
                      onChange={() => handleTagToggle(tag)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-700 dark:text-gray-300">{tag}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Location filters */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                Country
              </label>
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">All Countries</option>
                {availableCountries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                Region/State
              </label>
              <select
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">All Regions</option>
                {availableRegions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                City
              </label>
              <input
                type="text"
                value={filterCity}
                onChange={(e) => setFilterCity(e.target.value)}
                placeholder="Filter by city..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Sort option */}
          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Sort By
            </label>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:w-60"
            >
              <option value="date">Date (Earliest First)</option>
              <option value="title">Title (A-Z)</option>
              <option value="location">Location</option>
            </select>
          </div>
        </div>

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

      <SubscribeModal
        isOpen={showSubscribeModal}
        onClose={() => setShowSubscribeModal(false)}
        onConfirm={handleSubscribeToFilter}
        title="Subscribe to Filter"
        description={`Subscribe to receive events matching: ${getFilterDescription()}. Your calendar feed will automatically update as new events are added that match these filters.`}
        feedToken={feedToken}
        subscriptionType="custom"
      />
    </div>
  );
}
