'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { formatEventDateForDisplay } from '@/lib/events';

type Scan = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  newEvents: number;
  matchedEvents: number;
  error: string | null;
};

type Source = {
  id: string;
  name: string | null;
  url: string;
  enabled: boolean;
  authority: string;
  adapterType: string;
  region: string | null;
  checkInterval: number;
  lastChecked: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
  monitoringEndsAt: string | null;
  scans: Scan[];
  _count: { candidates: number; scans: number };
};

type CandidateEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string | null;
  temporalKind: string;
  location: string | null;
  url: string | null;
};

type Candidate = {
  id: string;
  sourceUrl: string;
  evidence: string | null;
  confidence: number | null;
  firstSeenAt: string;
  monitoredUrl: Source;
  pendingEvent: CandidateEvent | null;
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function formatDateOnly(value: string | null): string {
  if (!value) return 'No end date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function localEndOfDayIso(value: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function monitoringEnded(source: Source): boolean {
  return Boolean(
    source.enabled && source.monitoringEndsAt && new Date(source.monitoringEndsAt) < new Date()
  );
}

export default function AdminEventWatchPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [region, setRegion] = useState('');
  const [topics, setTopics] = useState('');
  const [intervalHours, setIntervalHours] = useState(24);
  const [monitoringEndDate, setMonitoringEndDate] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourcesResponse, candidatesResponse] = await Promise.all([
        fetch('/api/admin/event-watch/sources'),
        fetch('/api/admin/event-watch/candidates'),
      ]);
      if (!sourcesResponse.ok || !candidatesResponse.ok) {
        throw new Error('Unable to load Event Watch');
      }
      const [sourcesData, candidatesData] = await Promise.all([
        sourcesResponse.json(),
        candidatesResponse.json(),
      ]);
      setSources(sourcesData.sources || []);
      setCandidates(candidatesData.candidates || []);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load Event Watch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addSource(event: FormEvent) {
    event.preventDefault();
    setBusyId('new-source');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/event-watch/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          region: region || null,
          topics: topics
            .split(',')
            .map((topic) => topic.trim())
            .filter(Boolean),
          checkInterval: intervalHours * 60 * 60 * 1000,
          authority: 'OFFICIAL',
          adapterType: 'GENERIC',
          monitoringEndsAt: localEndOfDayIso(monitoringEndDate),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to add source');
      setName('');
      setUrl('');
      setRegion('');
      setTopics('');
      setMonitoringEndDate('');
      setNotice('Source added. Run its first scan when ready.');
      await refresh();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add source');
    } finally {
      setBusyId(null);
    }
  }

  async function updateSource(source: Source, data: Record<string, unknown>) {
    setBusyId(source.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/event-watch/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Unable to update source');
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update source');
    } finally {
      setBusyId(null);
    }
  }

  async function scanSource(source: Source) {
    setBusyId(source.id);
    setError(null);
    setNotice(`Scanning ${source.name || source.url}…`);
    try {
      const response = await fetch(`/api/admin/event-watch/sources/${source.id}/scan`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scan failed');
      setNotice(
        `Scan complete: ${data.result.newEvents} new, ${data.result.matchedEvents} matched, ${data.result.skippedEvents} unchanged or skipped.`
      );
      await refresh();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed');
      setNotice(null);
    } finally {
      setBusyId(null);
    }
  }

  async function reviewCandidate(candidate: Candidate, action: 'approve' | 'reject') {
    setBusyId(candidate.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/event-watch/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Review failed');
      setNotice(action === 'approve' ? 'Event approved and published.' : 'Event rejected.');
      await refresh();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Event Watch</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Monitor official event sources. New events remain pending until you approve them; matches
          never overwrite published events.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-blue-800">
          {notice}
        </div>
      )}

      <form
        onSubmit={addSource}
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Add monitored source
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Source name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="TWIPN USA"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Official source URL
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="https://luma.com/twipnusa"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Region
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="United States"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Topics, comma separated
            <input
              value={topics}
              onChange={(event) => setTopics(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="programmatic, adtech, networking"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Check every
            <select
              value={intervalHours}
              onChange={(event) => setIntervalHours(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Stop checking after <span className="font-normal text-gray-500">(optional)</span>
            <input
              type="date"
              value={monitoringEndDate}
              onChange={(event) => setMonitoringEndDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
        </div>
        <button
          disabled={busyId === 'new-source'}
          className="mt-5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busyId === 'new-source' ? 'Adding…' : 'Add source'}
        </button>
      </form>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
            Sources ({sources.length})
          </h3>
          <button
            onClick={() => void refresh()}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-gray-500">Loading Event Watch…</p>
        ) : sources.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-gray-500">
            No monitored sources yet.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Active sources (
                {sources.filter((source) => source.enabled && !monitoringEnded(source)).length})
              </h4>
              {sources
                .filter((source) => source.enabled && !monitoringEnded(source))
                .map((source) => (
                  <article
                    key={source.id}
                    className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
                  >
                    <div className="flex flex-col justify-between gap-4 lg:flex-row">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-gray-900 dark:text-white">
                            {source.name || source.url}
                          </h4>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${source.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}
                          >
                            Active
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            {source.adapterType}
                          </span>
                        </div>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block truncate text-sm text-blue-600 hover:underline"
                        >
                          {source.url}
                        </a>
                        <div className="mt-3 grid gap-1 text-xs text-gray-500 sm:grid-cols-2">
                          <span>Last checked: {formatDate(source.lastChecked)}</span>
                          <span>Next check: {formatDate(source.nextCheckAt)}</span>
                          <span>
                            {source._count.scans} scans · {source._count.candidates} observations
                          </span>
                          <span>Every {Math.round(source.checkInterval / 3_600_000)} hours</span>
                          <span>Stops: {formatDateOnly(source.monitoringEndsAt)}</span>
                        </div>
                        <label className="mt-3 block max-w-xs text-xs font-medium text-gray-600 dark:text-gray-300">
                          Stop checking after
                          <input
                            type="date"
                            defaultValue={dateInputValue(source.monitoringEndsAt)}
                            disabled={busyId === source.id}
                            onChange={(event) =>
                              void updateSource(source, {
                                monitoringEndsAt: localEndOfDayIso(event.target.value),
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                          />
                        </label>
                        {source.lastError && (
                          <p className="mt-2 text-sm text-red-600">
                            Last error: {source.lastError}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          disabled={busyId === source.id || !source.enabled}
                          onClick={() => void scanSource(source)}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busyId === source.id ? 'Working…' : 'Scan now'}
                        </button>
                        <button
                          disabled={busyId === source.id}
                          onClick={() => void updateSource(source, { enabled: !source.enabled })}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200"
                        >
                          {source.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>

            {sources.some((source) => !source.enabled || monitoringEnded(source)) && (
              <details className="rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950/40">
                <summary className="cursor-pointer px-5 py-4 font-semibold text-gray-800 dark:text-gray-200">
                  Inactive sources (
                  {sources.filter((source) => !source.enabled || monitoringEnded(source)).length})
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    Disabled and monitoring ended
                  </span>
                </summary>
                <div className="space-y-4 border-t border-gray-200 p-4 dark:border-gray-700">
                  {sources
                    .filter((source) => !source.enabled || monitoringEnded(source))
                    .map((source) => {
                      const ended = monitoringEnded(source);
                      return (
                        <article
                          key={source.id}
                          className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
                        >
                          <div className="flex flex-col justify-between gap-4 lg:flex-row">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-semibold text-gray-900 dark:text-white">
                                  {source.name || source.url}
                                </h4>
                                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                                  {ended ? 'Monitoring ended' : 'Disabled'}
                                </span>
                              </div>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block truncate text-sm text-blue-600 hover:underline"
                              >
                                {source.url}
                              </a>
                              <p className="mt-2 text-xs text-gray-500">
                                {source._count.scans} scans · {source._count.candidates}{' '}
                                observations · Stops: {formatDateOnly(source.monitoringEndsAt)}
                              </p>
                              <label className="mt-3 block max-w-xs text-xs font-medium text-gray-600 dark:text-gray-300">
                                Stop checking after
                                <input
                                  type="date"
                                  defaultValue={dateInputValue(source.monitoringEndsAt)}
                                  disabled={busyId === source.id}
                                  onChange={(event) =>
                                    void updateSource(source, {
                                      monitoringEndsAt: localEndOfDayIso(event.target.value),
                                    })
                                  }
                                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                                />
                              </label>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button
                                disabled={busyId === source.id || !source.enabled}
                                onClick={() => void scanSource(source)}
                                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                              >
                                {busyId === source.id ? 'Working…' : 'Scan now'}
                              </button>
                              <button
                                disabled={busyId === source.id}
                                onClick={() =>
                                  void updateSource(source, { enabled: !source.enabled })
                                }
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200"
                              >
                                {source.enabled ? 'Disable' : 'Enable'}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xl font-semibold text-gray-900 dark:text-white">
          New events awaiting review ({candidates.length})
        </h3>
        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-gray-500">
            No Event Watch discoveries need review.
          </p>
        ) : (
          <div className="space-y-4">
            {candidates.map((candidate) => {
              const event = candidate.pendingEvent;
              return (
                <article
                  key={candidate.id}
                  className="rounded-xl border border-amber-300 bg-amber-50/40 p-5 dark:border-amber-700 dark:bg-amber-950/20"
                >
                  <div className="flex flex-col justify-between gap-5 lg:flex-row">
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {event?.title || 'Stored event candidate'}
                      </h4>
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                        {event
                          ? `${formatEventDateForDisplay(event.start, event, false)} · ${event.location || 'Location not provided'}`
                          : 'The pending record can be recovered from the stored extraction.'}
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        Source: {candidate.monitoredUrl.name || candidate.monitoredUrl.url} · First
                        seen {formatDate(candidate.firstSeenAt)}
                        {candidate.confidence != null
                          ? ` · ${Math.round(candidate.confidence * 100)}% evidence confidence`
                          : ''}
                      </p>
                      <a
                        href={candidate.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline"
                      >
                        Open official source
                      </a>
                      {candidate.evidence && (
                        <details className="mt-3 text-sm">
                          <summary className="cursor-pointer font-semibold text-gray-700 dark:text-gray-200">
                            View extraction evidence
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 p-3 text-gray-700 dark:bg-gray-900/70 dark:text-gray-300">
                            {candidate.evidence}
                          </p>
                        </details>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        disabled={busyId === candidate.id}
                        onClick={() => void reviewCandidate(candidate, 'approve')}
                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === candidate.id}
                        onClick={() => void reviewCandidate(candidate, 'reject')}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
