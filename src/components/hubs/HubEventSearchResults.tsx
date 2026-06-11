'use client';

import Link from 'next/link';
import { formatEventDateForDisplay } from '@/lib/events';
import type { HubSearchEvent } from '@/lib/hubs-client';

interface HubEventSearchResultsProps {
  hubSlug: string;
  query: string;
  events: HubSearchEvent[];
  loading: boolean;
  error: string | null;
  onSelectEvent: (event: HubSearchEvent) => void;
}

function excerpt(text: string | null | undefined, maxLen = 140): string | null {
  if (!text?.trim()) return null;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}…`;
}

export default function HubEventSearchResults({
  hubSlug,
  query,
  events,
  loading,
  error,
  onSelectEvent,
}: HubEventSearchResultsProps) {
  if (!query) return null;

  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Events matching &ldquo;{query}&rdquo;
      </h2>

      {loading && (
        <p className="text-gray-500 dark:text-gray-400 py-4">Searching events…</p>
      )}

      {!loading && error && (
        <p className="text-red-600 dark:text-red-400 py-4">{error}</p>
      )}

      {!loading && !error && events.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 py-4">
          No events match your search. Try different keywords or browse hosts below.
        </p>
      )}

      {!loading && !error && events.length > 0 && (
        <ul className="space-y-3">
          {events.map((event) => {
            const host = event.hubHost;
            const description = excerpt(event.description);

            return (
              <li
                key={event.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 md:p-5 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5">
                  <div className="sm:w-44 shrink-0 text-sm font-semibold text-tmc-navy dark:text-tmc-cyan-soft">
                    {formatEventDateForDisplay(event.start, event, false)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelectEvent(event)}
                      className="font-semibold text-lg text-gray-900 dark:text-white hover:text-tmc-blue text-left transition"
                    >
                      {event.title}
                    </button>
                    {host && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Hosted by{' '}
                        <Link
                          href={`/hubs/${hubSlug}/${host.slug}`}
                          className="text-tmc-blue hover:underline font-medium"
                        >
                          {host.name}
                        </Link>
                      </p>
                    )}
                    {event.location && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                        {event.location}
                      </p>
                    )}
                    {description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                        {description}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
