'use client';

import { Event } from '@prisma/client';
import { formatEventDateForDisplay } from '@/lib/events';

interface EventListProps {
  events: Event[];
  onSelect: (event: Event) => void;
  emptyStateMessage?: string;
}

function formatDate(value: Date | string | null, isAllDay: boolean = false, isEndDate: boolean = false) {
  if (!value) {
    return 'TBD';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return 'TBD';
  }

  // Use the shared utility function that handles all-day events correctly
  return formatEventDateForDisplay(date, isAllDay, isEndDate);
}

export default function EventList({ events, onSelect, emptyStateMessage }: EventListProps) {
  if (!events.length) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center text-gray-600 dark:text-gray-300">
        {emptyStateMessage || 'No published events yet. Check back soon!'}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Title
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Starts
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Ends
              </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Location
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Tags
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Source
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {events.map((event) => (
              <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/60">
                <td className="px-4 py-4 whitespace-normal text-sm font-medium text-gray-900 dark:text-gray-100">
                  <div className="flex flex-col gap-1">
                    <span>{event.title}</span>
                    {event.url && (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 underline break-all"
                      >
                        {event.url}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                  {formatDate(event.start, !event.timezone, false)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                  {formatDate(event.end, !event.timezone, true)}
                </td>
                <td className="px-4 py-4 whitespace-normal text-sm text-gray-700 dark:text-gray-300">
                  {(event.city || event.region || event.country) ? (
                    <div>
                      {[event.city, event.region, event.country].filter(Boolean).join(', ')}
                      {event.location && 
                       event.location !== [event.city, event.region, event.country].filter(Boolean).join(', ') && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {event.location}
                        </div>
                      )}
                    </div>
                  ) : (
                    event.location || 'Online'
                  )}
                </td>
                <td className="px-4 py-4 whitespace-normal text-sm text-gray-700 dark:text-gray-300">
                  {event.tags && (() => {
                    try {
                      const tagsArray = typeof event.tags === 'string' ? JSON.parse(event.tags) : event.tags;
                      return Array.isArray(tagsArray) && tagsArray.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tagsArray.map((tag: string) => (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    } catch {
                      return <span className="text-gray-400 dark:text-gray-500">—</span>;
                    }
                  })() || <span className="text-gray-400 dark:text-gray-500">—</span>}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                  {event.source || 'N/A'}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-right">
                  <button
                    onClick={() => onSelect(event)}
                    className="inline-flex items-center rounded-md bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700"
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
