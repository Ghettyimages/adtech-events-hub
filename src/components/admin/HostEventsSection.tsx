'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Event } from '@prisma/client';
import { formatEventDateForDisplay, isAllDayEvent } from '@/lib/events';
import { normalizeTags, parseStoredTags } from '@/lib/extractor/tagExtractor';

type StatusFilter = 'all' | 'published' | 'pending';
type GapFilter = 'none' | 'no_url' | 'no_location';
type BulkMode = 'only_empty' | 'overwrite';

interface HostEventsSectionProps {
  hostId: string;
  hostName: string;
  hubSlug: string;
  hostSlug: string;
  expanded: boolean;
  onEditEvent?: (event: Event) => void;
  onDeleteEvent?: (eventId: string) => Promise<void>;
  onBulkApplied?: () => void;
  refreshKey?: number;
}

function statusBadgeClass(status: string): string {
  if (status === 'PUBLISHED') {
    return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
  }
  if (status === 'PENDING') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

function isFieldEmpty(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

function filterByStatus(events: Event[], statusFilter: StatusFilter): Event[] {
  if (statusFilter === 'published') return events.filter((e) => e.status === 'PUBLISHED');
  if (statusFilter === 'pending') return events.filter((e) => e.status === 'PENDING');
  return events;
}

function countBulkTargets(
  events: Event[],
  field: 'url' | 'location' | 'source',
  mode: BulkMode
): { affected: number; skipped: number } {
  let affected = 0;
  let skipped = 0;
  for (const event of events) {
    const current = event[field];
    if (mode === 'overwrite' || isFieldEmpty(current)) {
      affected++;
    } else {
      skipped++;
    }
  }
  return { affected, skipped };
}

function parseTagsInput(input: string): string[] {
  return normalizeTags(
    input
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

function countTagAddTargets(events: Event[], addTags: string[]): number {
  if (addTags.length === 0) return 0;
  return events.filter((event) => {
    const current = parseStoredTags(event.tags);
    return addTags.some((tag) => !current.includes(tag));
  }).length;
}

function countTagRemoveTargets(events: Event[], removeTags: string[]): number {
  if (removeTags.length === 0) return 0;
  const removeSet = new Set(removeTags);
  return events.filter((event) => {
    const current = parseStoredTags(event.tags);
    return current.some((tag) => removeSet.has(tag));
  }).length;
}

export default function HostEventsSection({
  hostId,
  hostName,
  hubSlug,
  hostSlug,
  expanded,
  onEditEvent,
  onDeleteEvent,
  onBulkApplied,
  refreshKey = 0,
}: HostEventsSectionProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [counts, setCounts] = useState({ published: 0, pending: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [gapFilter, setGapFilter] = useState<GapFilter>('none');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [bulkUrl, setBulkUrl] = useState('');
  const [bulkLocation, setBulkLocation] = useState('');
  const [bulkSource, setBulkSource] = useState(hostName);
  const [updateUrl, setUpdateUrl] = useState(false);
  const [updateLocation, setUpdateLocation] = useState(false);
  const [updateSource, setUpdateSource] = useState(false);
  const [updateAddTags, setUpdateAddTags] = useState(false);
  const [updateRemoveTags, setUpdateRemoveTags] = useState(false);
  const [bulkAddTags, setBulkAddTags] = useState('');
  const [bulkRemoveTags, setBulkRemoveTags] = useState('');
  const [bulkMode, setBulkMode] = useState<BulkMode>('only_empty');
  const [bulkApplying, setBulkApplying] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/hub-hosts/${hostId}/events?status=all`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load events');
      }
      const data = await res.json();
      setEvents(data.events ?? []);
      setCounts(data.counts ?? { published: 0, pending: 0, total: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    if (expanded) {
      fetchEvents();
    }
  }, [expanded, fetchEvents, refreshKey]);

  useEffect(() => {
    setBulkSource(hostName);
  }, [hostName]);

  const scopeEvents = useMemo(
    () => filterByStatus(events, statusFilter),
    [events, statusFilter]
  );

  const gapCounts = useMemo(
    () => ({
      noUrl: scopeEvents.filter((e) => isFieldEmpty(e.url)).length,
      noLocation: scopeEvents.filter((e) => isFieldEmpty(e.location)).length,
    }),
    [scopeEvents]
  );

  const filteredEvents = useMemo(() => {
    let list = scopeEvents;
    if (gapFilter === 'no_url') {
      list = list.filter((e) => isFieldEmpty(e.url));
    } else if (gapFilter === 'no_location') {
      list = list.filter((e) => isFieldEmpty(e.location));
    }
    return list;
  }, [scopeEvents, gapFilter]);

  const parsedAddTags = useMemo(
    () => (updateAddTags ? parseTagsInput(bulkAddTags) : []),
    [updateAddTags, bulkAddTags]
  );
  const parsedRemoveTags = useMemo(
    () => (updateRemoveTags ? parseTagsInput(bulkRemoveTags) : []),
    [updateRemoveTags, bulkRemoveTags]
  );

  const bulkPreview = useMemo(() => {
    const parts: string[] = [];
    if (updateUrl) {
      const { affected, skipped } = countBulkTargets(scopeEvents, 'url', bulkMode);
      parts.push(`URL: ${affected} event${affected === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`);
    }
    if (updateLocation) {
      const { affected, skipped } = countBulkTargets(scopeEvents, 'location', bulkMode);
      parts.push(
        `Location: ${affected} event${affected === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`
      );
    }
    if (updateSource) {
      const { affected, skipped } = countBulkTargets(scopeEvents, 'source', bulkMode);
      parts.push(
        `Source: ${affected} event${affected === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`
      );
    }
    if (updateAddTags && parsedAddTags.length > 0) {
      const affected = countTagAddTargets(scopeEvents, parsedAddTags);
      const skipped = scopeEvents.length - affected;
      parts.push(
        `Add tags [${parsedAddTags.join(', ')}]: ${affected} event${affected === 1 ? '' : 's'}${skipped ? ` (${skipped} already have)` : ''}`
      );
    }
    if (updateRemoveTags && parsedRemoveTags.length > 0) {
      const affected = countTagRemoveTargets(scopeEvents, parsedRemoveTags);
      parts.push(
        `Remove tags [${parsedRemoveTags.join(', ')}]: ${affected} event${affected === 1 ? '' : 's'}`
      );
    }
    return parts;
  }, [
    scopeEvents,
    updateUrl,
    updateLocation,
    updateSource,
    updateAddTags,
    updateRemoveTags,
    parsedAddTags,
    parsedRemoveTags,
    bulkMode,
  ]);

  const statusScopeLabel =
    statusFilter === 'all'
      ? `${scopeEvents.length} event${scopeEvents.length === 1 ? '' : 's'}`
      : `${scopeEvents.length} ${statusFilter} event${scopeEvents.length === 1 ? '' : 's'}`;

  const handleDelete = async (eventId: string) => {
    if (!onDeleteEvent) return;
    setDeletingId(eventId);
    try {
      await onDeleteEvent(eventId);
      await fetchEvents();
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkApply = async () => {
    if (!updateUrl && !updateLocation && !updateSource && !updateAddTags && !updateRemoveTags) {
      setBulkMessage('Select at least one field or tag action.');
      return;
    }
    if (updateUrl && !bulkUrl.trim()) {
      setBulkMessage('Enter a URL or uncheck Update URL.');
      return;
    }
    if (updateLocation && !bulkLocation.trim()) {
      setBulkMessage('Enter a location or uncheck Update location.');
      return;
    }
    if (updateSource && !bulkSource.trim()) {
      setBulkMessage('Enter a source or uncheck Update source.');
      return;
    }
    if (updateAddTags && parsedAddTags.length === 0) {
      setBulkMessage('Enter at least one tag to add, or uncheck Add tags.');
      return;
    }
    if (updateRemoveTags && parsedRemoveTags.length === 0) {
      setBulkMessage('Enter at least one tag to remove, or uncheck Remove tags.');
      return;
    }

    const preview = bulkPreview.join('\n');
    const fieldModeNote =
      updateUrl || updateLocation || updateSource
        ? bulkMode === 'overwrite'
          ? '\n\nURL/location/source: existing values will be overwritten where selected.'
          : '\n\nURL/location/source: only empty fields will be updated.'
        : '';
    const tagModeNote =
      updateAddTags || updateRemoveTags
        ? '\n\nTags: other tags are kept; add skips events that already have the tag; remove only drops listed tags.'
        : '';
    if (!confirm(`Apply bulk changes to ${statusScopeLabel}?\n\n${preview}${fieldModeNote}${tagModeNote}`)) {
      return;
    }

    setBulkApplying(true);
    setBulkMessage(null);
    try {
      const res = await fetch(`/api/admin/hub-hosts/${hostId}/events/bulk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: updateUrl ? bulkUrl.trim() : undefined,
          location: updateLocation ? bulkLocation.trim() : undefined,
          source: updateSource ? bulkSource.trim() : undefined,
          updateUrl,
          updateLocation,
          updateSource,
          addTags: updateAddTags ? parsedAddTags : undefined,
          removeTags: updateRemoveTags ? parsedRemoveTags : undefined,
          updateAddTags,
          updateRemoveTags,
          mode: bulkMode,
          status: statusFilter,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk update failed');

      setBulkMessage(`Updated ${data.updated} of ${data.total} event${data.total === 1 ? '' : 's'}.`);
      await fetchEvents();
      onBulkApplied?.();
    } catch (err) {
      setBulkMessage(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkApplying(false);
    }
  };

  if (!expanded) return null;

  const filterChipClass = (active: boolean) =>
    `px-2 py-1 rounded border transition ${
      active
        ? 'bg-blue-600 text-white border-blue-600'
        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
    }`;

  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800/60">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h5 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Events under {hostName}
          </h5>
          <Link
            href={`/hubs/${hubSlug}/${hostSlug}`}
            target="_blank"
            className="text-xs text-tmc-blue hover:underline"
          >
            View public host page →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {(['all', 'published', 'pending'] as const).map((filter) => {
            const label =
              filter === 'all'
                ? `All (${counts.total})`
                : filter === 'published'
                  ? `Published (${counts.published})`
                  : `Pending (${counts.pending})`;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => {
                  setStatusFilter(filter);
                  setGapFilter('none');
                }}
                className={filterChipClass(statusFilter === filter && gapFilter === 'none')}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setGapFilter(gapFilter === 'no_url' ? 'none' : 'no_url')}
            className={filterChipClass(gapFilter === 'no_url')}
          >
            No URL ({gapCounts.noUrl})
          </button>
          <button
            type="button"
            onClick={() => setGapFilter(gapFilter === 'no_location' ? 'none' : 'no_location')}
            className={filterChipClass(gapFilter === 'no_location')}
          >
            No location ({gapCounts.noLocation})
          </button>
        </div>
      </div>

      <div className="mb-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
        <button
          type="button"
          onClick={() => setBulkExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900/40 rounded-lg transition"
        >
          <span>{bulkExpanded ? '▾' : '▸'} Bulk fill fields</span>
          <span className="text-xs font-normal text-gray-500">Scope: {statusScopeLabel}</span>
        </button>
        {bulkExpanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={updateUrl}
                  onChange={(e) => setUpdateUrl(e.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    URL
                  </span>
                  <input
                    type="url"
                    value={bulkUrl}
                    onChange={(e) => setBulkUrl(e.target.value)}
                    disabled={!updateUrl}
                    placeholder="https://..."
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                  />
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={updateLocation}
                  onChange={(e) => setUpdateLocation(e.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Location
                  </span>
                  <input
                    type="text"
                    value={bulkLocation}
                    onChange={(e) => setBulkLocation(e.target.value)}
                    disabled={!updateLocation}
                    placeholder="Venue or address"
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                  />
                </span>
              </label>
              <label className="flex items-start gap-2 md:col-span-2">
                <input
                  type="checkbox"
                  checked={updateSource}
                  onChange={(e) => setUpdateSource(e.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1 max-w-md">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Source (host name)
                  </span>
                  <input
                    type="text"
                    value={bulkSource}
                    onChange={(e) => setBulkSource(e.target.value)}
                    disabled={!updateSource}
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                  />
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={updateAddTags}
                  onChange={(e) => setUpdateAddTags(e.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Add tags
                  </span>
                  <input
                    type="text"
                    value={bulkAddTags}
                    onChange={(e) => setBulkAddTags(e.target.value)}
                    disabled={!updateAddTags}
                    placeholder="invite-only, networking (comma-separated)"
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Adds to each event; skips if tag already present
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={updateRemoveTags}
                  onChange={(e) => setUpdateRemoveTags(e.target.checked)}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Remove tags
                  </span>
                  <input
                    type="text"
                    value={bulkRemoveTags}
                    onChange={(e) => setBulkRemoveTags(e.target.value)}
                    disabled={!updateRemoveTags}
                    placeholder="email (comma-separated)"
                    className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Removes only listed tags; keeps all other tags
                  </span>
                </span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`bulk-mode-${hostId}`}
                  checked={bulkMode === 'only_empty'}
                  onChange={() => setBulkMode('only_empty')}
                />
                Only fill empty (default) — URL, location, source
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`bulk-mode-${hostId}`}
                  checked={bulkMode === 'overwrite'}
                  onChange={() => setBulkMode('overwrite')}
                />
                Overwrite all in scope — URL, location, source
              </label>
            </div>
            {bulkPreview.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Preview: {bulkPreview.join(' · ')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleBulkApply}
                disabled={bulkApplying || scopeEvents.length === 0}
                className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition font-semibold"
              >
                {bulkApplying ? 'Applying…' : `Apply to ${statusScopeLabel}`}
              </button>
            </div>
            {bulkMessage && (
              <p
                className={`text-xs ${
                  bulkMessage.startsWith('Updated')
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {bulkMessage}
              </p>
            )}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading events…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !error && filteredEvents.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {events.length === 0
            ? 'No events assigned to this host yet.'
            : 'No events match this filter.'}
        </p>
      )}

      {!loading && !error && filteredEvents.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
          {filteredEvents.map((event) => {
            const allDay = isAllDayEvent(event);
            return (
              <li
                key={event.id}
                className="py-2 flex flex-wrap items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {event.title}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusBadgeClass(event.status)}`}
                    >
                      {event.status}
                    </span>
                    {isFieldEmpty(event.url) && (
                      <span className="text-xs text-orange-600 dark:text-orange-400">no URL</span>
                    )}
                    {isFieldEmpty(event.location) && (
                      <span className="text-xs text-orange-600 dark:text-orange-400">
                        no location
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {formatEventDateForDisplay(event.start, event, false)}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onEditEvent && (
                    <button
                      type="button"
                      onClick={() => onEditEvent(event)}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-semibold"
                    >
                      Edit
                    </button>
                  )}
                  {onDeleteEvent && (
                    <button
                      type="button"
                      onClick={() => handleDelete(event.id)}
                      disabled={deletingId === event.id}
                      className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition font-semibold"
                    >
                      {deletingId === event.id ? '…' : 'Delete'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
