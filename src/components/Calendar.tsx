'use client';

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Event, Tag } from '@prisma/client';
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
import { mergeTagsWithPredefined, getDisplayName } from '@/lib/tags';
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
  const [filterSource, setFilterSource] = useState<string>(
    searchParams.get('source') || ''
  );
  const [sortOption, setSortOption] = useState<string>(
    searchParams.get('sort') || 'date'
  );
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [availableTags, setAvailableTags] = useState<Array<Tag | { name: string; displayName: string }>>([]);
  const [tagsLoading, setTagsLoading] = useState(true);

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
      if (filterSource) {
        params.set('source', filterSource);
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
  }, [selectedTags, filterCountry, filterRegion, filterCity, filterSource, sortOption]);

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
      if (filterSource) {
        params.set('source', filterSource);
      }
      if (sortOption && sortOption !== 'date') {
        params.set('sort', sortOption);
      }

      const queryString = params.toString();
      const newUrl = queryString ? `?${queryString}` : window.location.pathname;
      router.replace(newUrl, { scroll: false });
    }, 300); // Debounce URL updates

    return () => clearTimeout(timer);
  }, [selectedTags, filterCountry, filterRegion, filterCity, filterSource, sortOption, router]);

  // Fetch events when filters change
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Fetch tags from API
  useEffect(() => {
    const fetchTags = async () => {
      try {
        setTagsLoading(true);
        const res = await fetch('/api/tags?sort=name');
        if (res.ok) {
          const data = await res.json();
          const databaseTags = data.tags || [];
          // Merge database tags with predefined tags, deduplicating
          const merged = mergeTagsWithPredefined(databaseTags, PREDEFINED_TAGS);
          setAvailableTags(merged);
        } else {
          console.error('Failed to fetch tags');
          // Fallback to predefined tags only
          const fallback = PREDEFINED_TAGS.map((tag) => ({ name: tag, displayName: tag }));
          setAvailableTags(fallback);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
        // Fallback to predefined tags only
        const fallback = PREDEFINED_TAGS.map((tag) => ({ name: tag, displayName: tag }));
        setAvailableTags(fallback);
      } finally {
        setTagsLoading(false);
      }
    };

    fetchTags();
  }, []);

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

  const availableSources = useMemo(() => {
    const sources = new Set<string>();
    events.forEach((event) => {
      if (event.source) sources.add(event.source);
    });
    return Array.from(sources).sort();
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
    setFilterSource('');
    setSortOption('date');
  };

  const hasActiveFilters = selectedTags.length > 0 || filterCountry || filterRegion || filterCity || filterSource || (sortOption && sortOption !== 'date');

  // Get filter description for subscription
  const getFilterDescription = () => {
    const parts: string[] = [];
    if (selectedTags.length > 0) {
      parts.push(`Tags: ${selectedTags.join(', ')}`);
    }
    if (filterCountry) parts.push(`Country: ${filterCountry}`);
    if (filterRegion) parts.push(`Region: ${filterRegion}`);
    if (filterCity) parts.push(`City: ${filterCity}`);
    if (filterSource) parts.push(`Source: ${filterSource}`);
    return parts.join(' • ') || 'Current filter';
  };

  const handleSubscribeToFilter = async () => {
    const filter = {
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      country: filterCountry || undefined,
      region: filterRegion || undefined,
      city: filterCity || undefined,
      source: filterSource || undefined,
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
        {/* Filter Button and Active Filters (always visible) */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg
              className={`h-5 w-5 transition-transform ${showFilters ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="ml-1 rounded-full bg-purple-600 px-2 py-0.5 text-xs text-white">
                {selectedTags.length + (filterCountry ? 1 : 0) + (filterRegion ? 1 : 0) + (filterCity ? 1 : 0) + (filterSource ? 1 : 0) + (sortOption !== 'date' ? 1 : 0)}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Active filter chips (always visible when filters are active) */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tagName) => {
              const tag = availableTags.find((t) => t.name === tagName);
              const displayName = tag ? getDisplayName(tag) : tagName;
              const tagColor = 'color' in tag && tag.color ? tag.color : undefined;
              
              return (
                <span
                  key={tagName}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                  style={tagColor ? { backgroundColor: tagColor + '20', color: tagColor } : undefined}
                >
                  Tag: {displayName}
                  <button
                    onClick={() => handleTagToggle(tagName)}
                    className="hover:text-blue-600 dark:hover:text-blue-300 ml-1"
                  >
                    ×
                  </button>
                </span>
              );
            })}
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
            {filterSource && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                Source: {filterSource}
                <button
                  onClick={() => setFilterSource('')}
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
        )}

        {/* Subscribe to Filter button (always visible when filters are active) */}
        {hasActiveFilters && status === 'authenticated' && (
          <div className="pt-2">
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

        {/* Collapsible Filter UI */}
        {showFilters && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            {/* Tags filter */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                Tags
              </label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-gray-300 p-2 dark:border-gray-700">
                {tagsLoading ? (
                  <div className="px-2 py-1 text-sm text-gray-500">Loading tags...</div>
                ) : availableTags.length === 0 ? (
                  <div className="px-2 py-1 text-sm text-gray-500">No tags available</div>
                ) : (
                  availableTags.map((tag) => {
                    const displayName = getDisplayName(tag);
                    const tagColor = 'color' in tag && tag.color ? tag.color : undefined;
                    const isSelected = selectedTags.includes(tag.name);
                    
                    return (
                      <label key={tag.name} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleTagToggle(tag.name)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="flex-1 text-gray-700 dark:text-gray-300">{displayName}</span>
                        {tagColor && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: tagColor }}
                            title={`Tag color: ${tagColor}`}
                          />
                        )}
                      </label>
                    );
                  })
                )}
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

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                Source
              </label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">All Sources</option>
                {availableSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
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
        )}

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
