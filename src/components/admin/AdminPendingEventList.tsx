'use client';

import Link from 'next/link';
import type { Event } from '@prisma/client';
import { formatEventDateForDisplay } from '@/lib/events';
import { isAllDayEvent } from '@/lib/eventTemporal';

export interface EventHubLabel {
  hubName: string;
  hostName: string | null;
  hubSlug?: string;
  hostSlug?: string;
}

export type PendingEventRow = Event & {
  submitter?: { name: string | null; email: string | null } | null;
};

interface AdminPendingEventListProps {
  events: PendingEventRow[];
  emptyMessage: string;
  getEventHubLabel: (event: Event) => EventHubLabel | null;
  onEdit: (event: PendingEventRow) => void;
  onAssign: (event: PendingEventRow) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDuplicateReview?: (event: PendingEventRow) => void;
  /** Show hub/host badge on cards (hub pending queue). */
  showHubBadge?: boolean;
}

export default function AdminPendingEventList({
  events,
  emptyMessage,
  getEventHubLabel,
  onEdit,
  onAssign,
  onApprove,
  onReject,
  onDuplicateReview,
  showHubBadge = true,
}: AdminPendingEventListProps) {
  if (events.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-600 dark:text-gray-400 text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {events.map((event) => {
        const hubLabel = showHubBadge ? getEventHubLabel(event) : null;
        const allDay = isAllDayEvent(event);

        return (
          <div
            key={event.id}
            className={`bg-white dark:bg-gray-800 border rounded-lg p-6 shadow-md ${
              event.duplicateReviewStatus === 'PENDING_REVIEW'
                ? 'border-amber-400 bg-amber-50/40 dark:border-amber-500 dark:bg-amber-900/20'
                : showHubBadge
                  ? 'border-purple-200 dark:border-purple-800'
                  : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {event.title}
                  </h2>
                  {event.subscribers > 0 && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      👥 {event.subscribers}{' '}
                      {event.subscribers === 1 ? 'subscriber' : 'subscribers'}
                    </span>
                  )}
                  {event.duplicateReviewStatus === 'PENDING_REVIEW' &&
                    event.potentialDuplicateOfId && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                        Potential duplicate
                      </span>
                    )}
                  {hubLabel && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">
                      🎪 {hubLabel.hubName}
                      {hubLabel.hostName ? ` · ${hubLabel.hostName}` : ' · no host yet'}
                    </span>
                  )}
                </div>
                {hubLabel?.hubSlug && (
                  <p className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                    Publishes to{' '}
                    <Link
                      href={`/hubs/${hubLabel.hubSlug}`}
                      className="underline font-medium"
                      target="_blank"
                    >
                      {hubLabel.hubName}
                    </Link>
                    {hubLabel.hostName && hubLabel.hubSlug && hubLabel.hostSlug && (
                      <>
                        {' '}
                        →{' '}
                        <Link
                          href={`/hubs/${hubLabel.hubSlug}/${hubLabel.hostSlug}`}
                          className="underline font-medium"
                          target="_blank"
                        >
                          {hubLabel.hostName}
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <p>
                    <strong>Start:</strong>{' '}
                    {formatEventDateForDisplay(event.start, event, false)}
                  </p>
                  <p>
                    <strong>End:</strong>{' '}
                    {formatEventDateForDisplay(event.end, event, true)}
                  </p>
                  {event.location && (
                    <p>
                      <strong>Location:</strong> {event.location}
                    </p>
                  )}
                  {event.timezone && (
                    <p>
                      <strong>Timezone:</strong> {event.timezone}
                    </p>
                  )}
                  {event.source && (
                    <p>
                      <strong>Source:</strong> {event.source}
                    </p>
                  )}
                  {event.submitter && (
                    <p>
                      <strong>Submitted by:</strong>{' '}
                      {event.submitter.name || 'Unknown'} (
                      {event.submitter.email || 'No email'})
                    </p>
                  )}
                  {event.tags && (() => {
                    try {
                      const tagsArray =
                        typeof event.tags === 'string'
                          ? JSON.parse(event.tags)
                          : event.tags;
                      return Array.isArray(tagsArray) && tagsArray.length > 0 ? (
                        <p>
                          <strong>Tags:</strong>{' '}
                          <span className="flex flex-wrap gap-1 mt-1">
                            {tagsArray.map((tag: string) => (
                              <span
                                key={tag}
                                className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                              >
                                {tag}
                              </span>
                            ))}
                          </span>
                        </p>
                      ) : null;
                    } catch {
                      return null;
                    }
                  })()}
                  {event.url && (
                    <p>
                      <strong>URL:</strong>{' '}
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline break-all"
                      >
                        {event.url}
                      </a>
                    </p>
                  )}
                </div>
                {event.description && (
                  <div className="mt-4">
                    <strong className="text-sm text-gray-700 dark:text-gray-300">
                      Description:
                    </strong>
                    <p className="text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                      {event.description}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-4 border-t">
              {event.duplicateReviewStatus === 'PENDING_REVIEW' &&
                event.potentialDuplicateOfId &&
                onDuplicateReview && (
                  <button
                    type="button"
                    onClick={() => onDuplicateReview(event)}
                    className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-semibold"
                  >
                    Review
                  </button>
                )}
              <button
                type="button"
                onClick={() => onEdit(event)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                onClick={() => onAssign(event)}
                className={`px-6 py-2 rounded-lg transition font-semibold ${
                  event.hubId
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200'
                }`}
              >
                🎪 {event.hubId ? 'Hub ✓' : 'Hub'}
              </button>
              <button
                type="button"
                onClick={() => onApprove(event.id)}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
              >
                ✅ Approve
              </button>
              <button
                type="button"
                onClick={() => onReject(event.id)}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
              >
                ❌ Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
