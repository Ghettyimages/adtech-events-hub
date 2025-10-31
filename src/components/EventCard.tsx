'use client';

import { Event } from '@prisma/client';
import { format } from 'date-fns';
import AddToCalendarLink from './AddToCalendarLink';

interface EventCardProps {
  event: Event;
  onClose: () => void;
}

export default function EventCard({ event, onClose }: EventCardProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{event.title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Date & Time
              </h3>
              <p className="text-gray-900 dark:text-gray-100">
                <strong>Start:</strong> {format(new Date(event.start), 'PPpp')}
              </p>
              <p className="text-gray-900 dark:text-gray-100">
                <strong>End:</strong> {format(new Date(event.end), 'PPpp')}
              </p>
              {event.timezone && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Timezone: {event.timezone}
                </p>
              )}
            </div>

            {event.location && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Location
                </h3>
                <p className="text-gray-900 dark:text-gray-100">{event.location}</p>
              </div>
            )}

            {event.description && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Description
                </h3>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {event.url && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Event Link
                </h3>
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline break-all"
                >
                  {event.url}
                </a>
              </div>
            )}

            {event.source && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Source
                </h3>
                <p className="text-gray-700 dark:text-gray-300">{event.source}</p>
              </div>
            )}

            <div className="pt-4 border-t">
              <AddToCalendarLink event={event} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
