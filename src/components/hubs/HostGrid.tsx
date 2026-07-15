'use client';

import { useEffect, useMemo, useState } from 'react';
import { Event } from '@prisma/client';
import type { HubHostSummary, HubSearchEvent } from '@/lib/hubs-client';
import EventCard from '@/components/EventCard';
import HostCard from './HostCard';
import HubEventSearchResults from './HubEventSearchResults';

interface HostGridProps {
  hubSlug: string;
  hosts: HubHostSummary[];
}

const SEARCH_DEBOUNCE_MS = 300;

export default function HostGrid({ hubSlug, hosts }: HostGridProps) {
  const [search, setSearch] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [eventResults, setEventResults] = useState<HubSearchEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!debouncedQuery) {
      setEventResults([]);
      setEventsLoading(false);
      setEventsError(null);
      return;
    }

    const controller = new AbortController();
    setEventsLoading(true);
    setEventsError(null);

    fetch(`/api/hubs/${hubSlug}/events?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to search events');
        }
        const data = await res.json();
        setEventResults(data.events ?? []);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setEventResults([]);
        setEventsError('Could not search events. Please try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setEventsLoading(false);
        }
      });

    return () => controller.abort();
  }, [debouncedQuery, hubSlug]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.slug.toLowerCase().includes(q) ||
        h.description?.toLowerCase().includes(q)
    );
  }, [hosts, search]);

  const featured = filtered.filter((h) => h.featured);
  const rest = filtered.filter((h) => !h.featured);
  const isSearching = search.trim().length > 0;
  const showHostSections = !isSearching || filtered.length > 0;

  return (
    <div onMouseLeave={() => setActiveHostId(null)}>
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search hosts or events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[44px]"
        />
      </div>

      <HubEventSearchResults
        hubSlug={hubSlug}
        query={debouncedQuery}
        events={eventResults}
        loading={eventsLoading}
        error={eventsError}
        onSelectEvent={(event) => setSelectedEvent(event as unknown as Event)}
      />

      {isSearching && showHostSections && (
        <h2 className="text-lg font-semibold text-tmc-navy mb-4">
          Hosts matching &ldquo;{search.trim()}&rdquo;
        </h2>
      )}

      {showHostSections && featured.length > 0 && (
        <section className="mb-10">
          {!isSearching && (
            <h2 className="text-lg font-semibold text-tmc-navy mb-4">
              Featured hosts
            </h2>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {featured.map((host) => (
              <HostCard
                key={host.id}
                hubSlug={hubSlug}
                host={host}
                isActive={activeHostId === host.id}
                onActivate={() => setActiveHostId(host.id)}
                onDeactivate={() =>
                  setActiveHostId((current) => (current === host.id ? null : current))
                }
              />
            ))}
          </div>
        </section>
      )}

      {showHostSections && (
        <section>
          {!isSearching && (
            <h2 className="text-lg font-semibold text-tmc-navy mb-4">All hosts</h2>
          )}
          {rest.length === 0 && featured.length === 0 ? (
            <p className="text-tmc-muted">No hosts match your search.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {rest.map((host) => (
                <HostCard
                  key={host.id}
                  hubSlug={hubSlug}
                  host={host}
                  isActive={activeHostId === host.id}
                  onActivate={() => setActiveHostId(host.id)}
                  onDeactivate={() =>
                    setActiveHostId((current) => (current === host.id ? null : current))
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {selectedEvent && (
        <EventCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
