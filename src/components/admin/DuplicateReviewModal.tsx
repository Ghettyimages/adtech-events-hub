'use client';

import { useEffect, useState } from 'react';

interface ReviewEvent {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  start: string | Date;
  end: string | Date;
  timezone: string | null;
  source: string | null;
  tags: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  potentialDuplicateOfId?: string | null;
  duplicateReviewStatus?: string | null;
}

type DuplicateReviewAction = 'merge' | 'replace' | 'keep_both' | 'dismiss';

interface DuplicateReviewModalProps {
  isOpen: boolean;
  pendingEvent: ReviewEvent | null;
  onClose: () => void;
  onResolved: () => Promise<void> | void;
}

const formatReviewDate = (value: string | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString();
};

const renderTags = (tags: string | null) => {
  if (!tags) return null;
  try {
    const parsed = JSON.parse(tags);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {parsed.map((tag: string) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          >
            {tag}
          </span>
        ))}
      </div>
    );
  } catch {
    return null;
  }
};

function EventSummary({ label, event }: { label: string; event: ReviewEvent }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{label}</h4>
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <p><strong>Title:</strong> {event.title}</p>
        {event.description && <p><strong>Description:</strong> {event.description}</p>}
        <p><strong>Start:</strong> {formatReviewDate(event.start)}</p>
        <p><strong>End:</strong> {formatReviewDate(event.end)}</p>
        {event.location && <p><strong>Location:</strong> {event.location}</p>}
        {event.timezone && <p><strong>Timezone:</strong> {event.timezone}</p>}
        {event.source && <p><strong>Source:</strong> {event.source}</p>}
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
        {(event.country || event.region || event.city) && (
          <p>
            <strong>Geo:</strong> {[event.country, event.region, event.city].filter(Boolean).join(', ')}
          </p>
        )}
        {renderTags(event.tags)}
      </div>
    </div>
  );
}

export default function DuplicateReviewModal({
  isOpen,
  pendingEvent,
  onClose,
  onResolved,
}: DuplicateReviewModalProps) {
  const [existingEvent, setExistingEvent] = useState<ReviewEvent | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<DuplicateReviewAction | null>(null);
  const [mergeTitle, setMergeTitle] = useState('');
  const [mergeDescription, setMergeDescription] = useState('');
  const [mergeLocation, setMergeLocation] = useState('');
  const [mergeUrl, setMergeUrl] = useState('');

  useEffect(() => {
    if (!isOpen || !pendingEvent?.potentialDuplicateOfId) {
      setExistingEvent(null);
      setError(null);
      return;
    }

    const loadExistingEvent = async () => {
      setLoadingExisting(true);
      setError(null);
      try {
        const response = await fetch(`/api/events/${pendingEvent.potentialDuplicateOfId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load matched event');
        }
        setExistingEvent(data.event as ReviewEvent);
      } catch (err: any) {
        setError(err.message || 'Failed to load matched event');
      } finally {
        setLoadingExisting(false);
      }
    };

    loadExistingEvent();
  }, [isOpen, pendingEvent]);

  useEffect(() => {
    if (!pendingEvent) return;
    setMergeTitle(pendingEvent.title);
    setMergeDescription(pendingEvent.description || '');
    setMergeLocation(pendingEvent.location || '');
    setMergeUrl(pendingEvent.url || '');
  }, [pendingEvent, isOpen]);

  const handleResolve = async (action: DuplicateReviewAction) => {
    if (!pendingEvent) return;
    setSubmittingAction(action);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        pendingEventId: pendingEvent.id,
        action,
      };
      if (action === 'merge') {
        body.mergedPayload = {
          title: mergeTitle.trim() || pendingEvent.title,
          description: mergeDescription.trim() || undefined,
          location: mergeLocation.trim() || undefined,
          url: mergeUrl.trim() || undefined,
        };
      }

      const response = await fetch('/api/events/duplicate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to resolve duplicate review');
      }
      await onResolved();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve duplicate review');
    } finally {
      setSubmittingAction(null);
    }
  };

  if (!isOpen || !pendingEvent) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
      <div className="w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 shadow-2xl">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Review potential duplicate</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Compare the incoming pending event with the existing event before deciding.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close duplicate review modal"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          {loadingExisting ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading matched event...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {existingEvent ? (
                  <EventSummary label="Existing event" event={existingEvent} />
                ) : (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
                    Existing event details are unavailable right now.
                  </div>
                )}
                <EventSummary label="Incoming pending event" event={pendingEvent} />
              </div>

              <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Edit merged values (optional — used for Merge)
                </h4>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  Defaults match the incoming pending event. Dates stay from the pending row unless you edit the event after merge.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Title</span>
                    <input
                      type="text"
                      value={mergeTitle}
                      onChange={(e) => setMergeTitle(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="text-gray-600 dark:text-gray-400">Location</span>
                    <input
                      type="text"
                      value={mergeLocation}
                      onChange={(e) => setMergeLocation(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="text-gray-600 dark:text-gray-400">URL</span>
                    <input
                      type="text"
                      value={mergeUrl}
                      onChange={(e) => setMergeUrl(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="text-gray-600 dark:text-gray-400">Description</span>
                    <textarea
                      value={mergeDescription}
                      onChange={(e) => setMergeDescription(e.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-6 flex flex-wrap gap-3">
          <button
            onClick={() => handleResolve('merge')}
            disabled={submittingAction !== null || loadingExisting}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {submittingAction === 'merge' ? 'Merging...' : 'Merge'}
          </button>
          <button
            onClick={() => handleResolve('replace')}
            disabled={submittingAction !== null || loadingExisting}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {submittingAction === 'replace' ? 'Replacing...' : 'Replace'}
          </button>
          <button
            onClick={() => handleResolve('keep_both')}
            disabled={submittingAction !== null || loadingExisting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {submittingAction === 'keep_both' ? 'Saving...' : 'Keep both'}
          </button>
          <button
            onClick={() => handleResolve('dismiss')}
            disabled={submittingAction !== null || loadingExisting}
            className="px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {submittingAction === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
          </button>
          <button
            onClick={onClose}
            disabled={submittingAction !== null}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 dark:text-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
