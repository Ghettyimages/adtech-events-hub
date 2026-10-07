'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { formatEventDateForDisplay } from '@/lib/events';

type Scan = {
  id: string;
  status: string;
  outcome?: string;
  summary?: string | null;
  startedAt: string;
  finishedAt: string | null;
  newEvents: number;
  changedEvents?: number;
  error: string | null;
  historyQuality?: string;
  fullExtractionRan?: boolean;
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
  lastFullScanAt: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
  monitoringEndsAt: string | null;
  requiresBrowser: boolean;
  monitorDetailPages: boolean;
  watchStatus: string;
  scans: Scan[];
  _count: { candidates: number; scans: number };
};

type SchedulerRun = {
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
} | null;

type CandidateEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string | null;
  temporalKind: string;
  location: string | null;
  url: string | null;
  description?: string | null;
};

type Candidate = {
  id: string;
  sourceUrl: string;
  evidence: string | null;
  matchStatus: string;
  reviewStatus: string;
  historyQuality?: string;
  firstSeenAt: string;
  monitoredUrl: { name: string | null; url: string };
  pendingEvent: CandidateEvent | null;
};

type Proposal = {
  id: string;
  kind: string;
  reviewStatus: string;
  sourceUrl: string;
  evidence: string | null;
  previousValues: Record<string, string | null>;
  proposedValues: Record<string, string | null>;
  changedFields: string[];
  createdAt: string;
  event: CandidateEvent;
  monitoredUrl: { name: string | null; url: string };
};

type CheckDetail = {
  id: string;
  summary: string | null;
  historyQuality: string;
  observations: Array<{ id: string; sourceUrl: string; payload: { title?: string; url?: string } }>;
  proposals: Proposal[];
  candidates: Candidate[];
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  start: 'Start',
  end: 'End',
  temporalKind: 'All-day or timed',
  timezone: 'Timezone',
  location: 'Location',
  city: 'City',
  region: 'Region',
  country: 'Country',
  url: 'Event URL',
  description: 'Description',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  }).format(new Date(value));
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
  return Boolean(source.enabled && source.monitoringEndsAt && new Date(source.monitoringEndsAt) < new Date());
}

function statusLabel(source: Source): string {
  if (source.watchStatus === 'checking') return 'Checking';
  if (source.watchStatus === 'overdue') return 'Overdue';
  if (monitoringEnded(source) || source.watchStatus === 'ended') return 'Monitoring ended';
  if (!source.enabled || source.watchStatus === 'disabled') return 'Disabled';
  return 'Active';
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export default function AdminEventWatchPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerRun>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
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
  const [requiresBrowser, setRequiresBrowser] = useState(false);
  const [monitorDetailPages, setMonitorDetailPages] = useState(false);
  const [monitoringEndDrafts, setMonitoringEndDrafts] = useState<Record<string, string>>({});
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [historyBySource, setHistoryBySource] = useState<Record<string, Scan[]>>({});
  const [historyCursor, setHistoryCursor] = useState<Record<string, string | null>>({});
  const [openChecks, setOpenChecks] = useState<Record<string, CheckDetail | 'loading'>>({});
  const [reviewFilter, setReviewFilter] = useState('pending');
  const [kindFilter, setKindFilter] = useState('all');
  const serverStopDates = useRef<Record<string, string>>({});

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [sourcesResponse, reviewResponse] = await Promise.all([
          fetch('/api/admin/event-watch/sources'),
          fetch(`/api/admin/event-watch/candidates?reviewStatus=${reviewFilter}&kind=${kindFilter}`),
        ]);
        if (!sourcesResponse.ok || !reviewResponse.ok) throw new Error('Unable to load Event Watch');
        const [sourcesData, reviewData] = await Promise.all([
          sourcesResponse.json(),
          reviewResponse.json(),
        ]);
        const refreshedSources: Source[] = sourcesData.sources || [];
        setSources(refreshedSources);
        setScheduler(sourcesData.scheduler || null);
        setMonitoringEndDrafts((current) => {
          const next = { ...current };
          for (const source of refreshedSources) {
            const saved = dateInputValue(source.monitoringEndsAt);
            if (next[source.id] === undefined || next[source.id] === serverStopDates.current[source.id]) {
              next[source.id] = saved;
            }
            serverStopDates.current[source.id] = saved;
          }
          return next;
        });
        setCandidates(reviewData.candidates || []);
        setProposals(reviewData.proposals || []);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : 'Unable to load Event Watch');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [kindFilter, reviewFilter]
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const checking = sources.some((source) => source.watchStatus === 'checking');
  useEffect(() => {
    if (!checking) return;
    const timer = window.setInterval(() => void refresh(true), 8000);
    return () => window.clearInterval(timer);
  }, [checking, refresh]);

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
          requiresBrowser,
          monitorDetailPages,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to add source');
      setName('');
      setUrl('');
      setRegion('');
      setTopics('');
      setMonitoringEndDate('');
      setRequiresBrowser(false);
      setMonitorDetailPages(false);
      setNotice('Source added. Run its first check when ready.');
      await refresh(true);
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
      await refresh(true);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update source');
    } finally {
      setBusyId(null);
    }
  }

  async function scanSource(source: Source, mode: 'check' | 'full') {
    setBusyId(source.id);
    setError(null);
    setNotice(mode === 'full' ? `Full scan of ${source.name || source.url}…` : `Checking ${source.name || source.url}…`);
    try {
      const response = await fetch(`/api/admin/event-watch/sources/${source.id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Check failed');
      setNotice(data.result?.summary || 'Check finished.');
      await refresh(true);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Check failed');
      setNotice(null);
      await refresh(true);
    } finally {
      setBusyId(null);
    }
  }

  async function loadHistory(source: Source) {
    const cursor = historyCursor[source.id];
    const response = await fetch(
      `/api/admin/event-watch/sources/${source.id}/history?take=10${cursor ? `&cursor=${cursor}` : ''}`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load history');
    setHistoryBySource((current) => ({
      ...current,
      [source.id]: [...(current[source.id] || source.scans), ...(data.scans || [])].filter(
        (scan, index, all) => all.findIndex((item) => item.id === scan.id) === index
      ),
    }));
    setHistoryCursor((current) => ({ ...current, [source.id]: data.nextCursor || null }));
    setExpandedSources((current) => ({ ...current, [source.id]: true }));
  }

  async function openCheck(scanId: string) {
    setOpenChecks((current) => ({ ...current, [scanId]: current[scanId] || 'loading' }));
    if (openChecks[scanId] && openChecks[scanId] !== 'loading') {
      setOpenChecks((current) => {
        const next = { ...current };
        delete next[scanId];
        return next;
      });
      return;
    }
    const response = await fetch(`/api/admin/event-watch/scans/${scanId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to open check');
    setOpenChecks((current) => ({ ...current, [scanId]: data.scan }));
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
      setNotice(action === 'approve' ? 'Event approved and published.' : 'Event rejected. The calendar was not changed.');
      await refresh(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  }

  async function reviewProposal(proposal: Proposal, action: 'approve' | 'reject') {
    setBusyId(proposal.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/event-watch/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Review failed');
      setNotice(
        action === 'approve'
          ? 'Proposed changes were applied.'
          : 'Changes rejected. The published event was not changed.'
      );
      await refresh(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  }

  function renderSource(source: Source) {
    const scans = historyBySource[source.id] || source.scans;
    return (
      <article
        key={source.id}
        className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-gray-900 dark:text-white">{source.name || source.url}</h4>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800 dark:bg-gray-800 dark:text-gray-100">
                {statusLabel(source)}
              </span>
            </div>
            <a href={source.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-blue-600 hover:underline">
              {source.url}
            </a>
            <div className="mt-3 grid gap-1 text-xs text-gray-500 sm:grid-cols-2">
              <span>Last checked: {formatDate(source.lastChecked)}</span>
              <span>Last successful check: {formatDate(source.lastSuccess)}</span>
              <span>Last full scan: {formatDate(source.lastFullScanAt)}</span>
              <span>Next check due: {formatDate(source.nextCheckAt)}</span>
              <span>Every {Math.round(source.checkInterval / 3_600_000)} hours</span>
              <span>Stops: {formatDateOnly(source.monitoringEndsAt)}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {source.requiresBrowser ? 'Browser-rendered agenda. ' : 'Listing page. '}
              {source.monitorDetailPages ? 'Linked event pages are included.' : 'Linked event pages are not checked.'}
            </p>
            <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Stop checking after
              <span className="mt-1 flex max-w-md flex-col gap-2 sm:flex-row">
                <input
                  type="date"
                  value={monitoringEndDrafts[source.id] ?? ''}
                  disabled={busyId === source.id}
                  onChange={(event) =>
                    setMonitoringEndDrafts((current) => ({ ...current, [source.id]: event.target.value }))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                />
                <button
                  type="button"
                  disabled={
                    busyId === source.id ||
                    (monitoringEndDrafts[source.id] ?? '') === dateInputValue(source.monitoringEndsAt)
                  }
                  onClick={() =>
                    void updateSource(source, {
                      monitoringEndsAt: localEndOfDayIso(monitoringEndDrafts[source.id] ?? ''),
                    })
                  }
                  className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-transparent dark:hover:bg-blue-950/30"
                >
                  {busyId === source.id ? 'Updating…' : 'Update stop date'}
                </button>
              </span>
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Scheduled checks stop on this date. Check now still runs after it.
            </p>
            {source.lastError && <p className="mt-2 text-sm text-red-600">Last error: {source.lastError}</p>}
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-blue-600 hover:underline"
              onClick={() => setExpandedSources((current) => ({ ...current, [source.id]: !current[source.id] }))}
            >
              {expandedSources[source.id] ? 'Hide history' : `History (${source._count.scans})`}
            </button>
            {expandedSources[source.id] && (
              <div className="mt-3 space-y-2">
                {scans.length === 0 && <p className="text-sm text-gray-500">No checks yet.</p>}
                {scans.map((scan) => (
                  <div key={scan.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{formatDate(scan.finishedAt || scan.startedAt)}</span>
                      <span className="font-medium text-gray-800 dark:text-gray-100">
                        {scan.summary || (scan.status === 'FAILED' ? 'Scan failed' : 'Check recorded')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-1 text-xs font-semibold text-blue-600 hover:underline"
                      onClick={() => void openCheck(scan.id).catch((openError) => setError(openError.message))}
                    >
                      {openChecks[scan.id] && openChecks[scan.id] !== 'loading' ? 'Hide this check' : 'Open this check'}
                    </button>
                    {openChecks[scan.id] === 'loading' && <p className="mt-2 text-xs text-gray-500">Loading check…</p>}
                    {openChecks[scan.id] && openChecks[scan.id] !== 'loading' && (
                      <CheckBody detail={openChecks[scan.id] as CheckDetail} />
                    )}
                  </div>
                ))}
                {historyCursor[source.id] !== null &&
                  (historyCursor[source.id] || source._count.scans > scans.length) && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-blue-600 hover:underline"
                    onClick={() => void loadHistory(source).catch((historyError) => setError(historyError.message))}
                  >
                    Show earlier checks
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <button
              disabled={busyId === source.id || !source.enabled}
              onClick={() => void scanSource(source, 'check')}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busyId === source.id ? 'Working…' : 'Check now'}
            </button>
            <button
              disabled={busyId === source.id || !source.enabled}
              onClick={() => void scanSource(source, 'full')}
              className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              Force full scan
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
    );
  }

  const activeSources = sources.filter((source) => source.enabled && !monitoringEnded(source));
  const inactiveSources = sources.filter((source) => !source.enabled || monitoringEnded(source));
  const schedulerStale =
    !scheduler || Date.now() - new Date(scheduler.startedAt).getTime() > 7 * 60 * 60 * 1000;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Event Watch</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Monitor official event sources. New events and changes to existing events stay in review until you approve
          them. Times are shown in {localZone()}.
        </p>
        <p className={`mt-2 text-sm ${schedulerStale ? 'text-amber-700' : 'text-gray-600'}`}>
          {scheduler
            ? `Scheduler last ran ${formatDate(scheduler.startedAt)}.${schedulerStale ? ' It has not run recently.' : ''}`
            : 'Scheduled checks have not run yet.'}
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-blue-800">{notice}</div>}

      <form onSubmit={addSource} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add monitored source</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Source name
            <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" placeholder="TWIPN USA" />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Official source URL
            <input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" placeholder="https://luma.com/twipnusa" />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Region
            <input value={region} onChange={(event) => setRegion(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" placeholder="United States" />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Topics, comma separated
            <input value={topics} onChange={(event) => setTopics(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" placeholder="programmatic, adtech, networking" />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Check every
            <select value={intervalHours} onChange={(event) => setIntervalHours(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800">
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Stop checking after <span className="font-normal text-gray-500">(optional)</span>
            <input type="date" value={monitoringEndDate} onChange={(event) => setMonitoringEndDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
          </label>
        </div>
        <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={requiresBrowser} onChange={(event) => setRequiresBrowser(event.target.checked)} />
            The agenda is built in the browser
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={monitorDetailPages} onChange={(event) => setMonitorDetailPages(event.target.checked)} />
            Also check linked event pages
          </label>
          <p className="text-xs text-gray-500">
            Ordinary checks compare the monitored page and skip extraction when it is unchanged. A full extraction still
            runs every 7 days. Force full scan extracts immediately. Linked pages, when enabled, are limited to the first
            8 links.
          </p>
        </div>
        <button disabled={busyId === 'new-source'} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busyId === 'new-source' ? 'Adding…' : 'Add source'}
        </button>
      </form>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Sources ({sources.length})</h3>
          <button onClick={() => void refresh(true)} className="text-sm font-semibold text-blue-600 hover:underline">
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-gray-500">Loading Event Watch…</p>
        ) : sources.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-gray-500">No monitored sources yet.</p>
        ) : (
          <div className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Active sources ({activeSources.length})</h4>
              {activeSources.map(renderSource)}
            </div>
            {inactiveSources.length > 0 && (
              <details className="rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950/40">
                <summary className="cursor-pointer px-5 py-4 font-semibold text-gray-800 dark:text-gray-200">
                  Inactive sources ({inactiveSources.length})
                  <span className="ml-2 text-sm font-normal text-gray-500">Disabled and monitoring ended</span>
                </summary>
                <div className="space-y-4 border-t border-gray-200 p-4 dark:border-gray-700">{inactiveSources.map(renderSource)}</div>
              </details>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Review</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800">
              <option value="all">All items</option>
              <option value="new">New events</option>
              <option value="changed">Changed events</option>
              <option value="discrepancy">Calendar discrepancies</option>
              <option value="ambiguous">Needs a closer look</option>
            </select>
            <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800">
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All statuses</option>
            </select>
          </div>
        </div>
        {proposals.map((proposal) => (
          <article key={proposal.id} className="mb-4 rounded-xl border border-sky-300 bg-sky-50/50 p-5 dark:border-sky-800 dark:bg-sky-950/20">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{proposal.event.title}</h4>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {proposal.kind === 'DISCREPANCY'
                ? 'Discrepancy with the calendar. This is the first comparison, not a recent source change.'
                : 'The source changed after the previous check.'}{' '}
              Status: {proposal.reviewStatus.toLowerCase()}.
            </p>
            <a href={proposal.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">
              Open source
            </a>
            <dl className="mt-3 space-y-2 text-sm">
              {(proposal.changedFields || []).map((field) => (
                <div key={field}>
                  <dt className="font-semibold text-gray-800 dark:text-gray-100">{FIELD_LABELS[field] || field}</dt>
                  <dd className="text-gray-600 dark:text-gray-300">
                    {proposal.previousValues?.[field] || 'Empty'} → {proposal.proposedValues?.[field] || 'Empty'}
                  </dd>
                </div>
              ))}
            </dl>
            {proposal.reviewStatus === 'PENDING' && (
              <div className="mt-4 flex gap-2">
                <button disabled={busyId === proposal.id} onClick={() => void reviewProposal(proposal, 'approve')} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                  Approve changes
                </button>
                <button disabled={busyId === proposal.id} onClick={() => void reviewProposal(proposal, 'reject')} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
        {candidates.length === 0 && proposals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-gray-500">Nothing in this view.</p>
        ) : (
          <div className="space-y-4">
            {candidates.map((candidate) => {
              const event = candidate.pendingEvent;
              return (
                <article key={candidate.id} className="rounded-xl border border-amber-300 bg-amber-50/40 p-5 dark:border-amber-700 dark:bg-amber-950/20">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">{event?.title || 'Stored event candidate'}</h4>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {candidate.matchStatus === 'AMBIGUOUS'
                      ? 'This may match more than one event. It was not merged automatically.'
                      : 'New event'}{' '}
                    · {candidate.reviewStatus.toLowerCase()}
                    {candidate.historyQuality === 'LEGACY' ? ' · Earlier discovery. Field-level history was not recorded.' : ''}
                  </p>
                  {event && (
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      {formatEventDateForDisplay(event.start, event, false)} · {event.location || 'Location not provided'}
                    </p>
                  )}
                  <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">
                    Open official source
                  </a>
                  {candidate.reviewStatus === 'PENDING' && (
                    <div className="mt-4 flex gap-2">
                      <button disabled={busyId === candidate.id} onClick={() => void reviewCandidate(candidate, 'approve')} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                        Approve
                      </button>
                      <button disabled={busyId === candidate.id} onClick={() => void reviewCandidate(candidate, 'reject')} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function CheckBody({ detail }: { detail: CheckDetail }) {
  return (
    <div className="mt-2 space-y-2 text-xs text-gray-600 dark:text-gray-300">
      <p>{detail.summary}</p>
      {detail.historyQuality === 'LEGACY' && <p>Detailed before/after results were not recorded for this earlier check.</p>}
      {detail.candidates?.map((candidate) => (
        <p key={candidate.id}>
          New or unmerged event: {candidate.pendingEvent?.title || 'Untitled'}{' '}
          <a className="text-blue-600 hover:underline" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
            source
          </a>
        </p>
      ))}
      {detail.proposals?.map((proposal) => (
        <p key={proposal.id}>
          {proposal.kind === 'DISCREPANCY' ? 'Calendar discrepancy' : 'Changed event'}: {proposal.event?.title}{' '}
          <a className="text-blue-600 hover:underline" href={proposal.sourceUrl} target="_blank" rel="noreferrer">
            source
          </a>
        </p>
      ))}
      {detail.observations?.length > 0 && detail.candidates?.length === 0 && detail.proposals?.length === 0 && (
        <p>{detail.observations.length} event details were saved with this check.</p>
      )}
    </div>
  );
}
