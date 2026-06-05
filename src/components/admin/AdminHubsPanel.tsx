'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Event } from '@prisma/client';
import HostEventsSection from '@/components/admin/HostEventsSection';

interface HubHost {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
  sourceAlias: string | null;
  featured: boolean;
  sortOrder: number;
  _count: { events: number };
}

interface HubRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  status: string;
  start: string;
  end: string;
  timezone: string | null;
  location: string | null;
  theme: string | null;
  sortOrder: number;
  hosts: HubHost[];
  _count: { events: number };
}

const STATUS_OPTIONS = ['DRAFT', 'UPCOMING', 'LIVE', 'ARCHIVED'] as const;

const EMPTY_HUB_FORM = {
  slug: '',
  name: '',
  tagline: '',
  description: '',
  startDate: '',
  endDate: '',
  timezone: '',
  location: '',
  status: 'DRAFT' as (typeof STATUS_OPTIONS)[number],
  theme: '',
};
type HubForm = typeof EMPTY_HUB_FORM;

const EMPTY_HOST_FORM = {
  slug: '',
  name: '',
  logoUrl: '',
  websiteUrl: '',
  description: '',
  sourceAlias: '',
  featured: false,
  sortOrder: 0,
};
type HostForm = typeof EMPTY_HOST_FORM;

// ISO -> yyyy-mm-dd (UTC portion), for <input type="date">
function isoToDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '';
}
// Festival convention: start = 00:00:00Z, end = 23:59:59Z
function dateToStartIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}
function dateToEndIso(date: string): string {
  return `${date}T23:59:59.000Z`;
}

function inputClass(extra = ''): string {
  return `w-full border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600 ${extra}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

interface AdminHubsPanelProps {
  onEditEvent?: (event: Event) => void;
  onDeleteEvent?: (eventId: string) => Promise<void>;
  onBulkApplied?: () => void;
  eventListRefreshKey?: number;
}

export default function AdminHubsPanel({
  onEditEvent,
  onDeleteEvent,
  onBulkApplied,
  eventListRefreshKey = 0,
}: AdminHubsPanelProps) {
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hub create
  const [creatingHub, setCreatingHub] = useState(false);
  const [newHub, setNewHub] = useState<HubForm>(EMPTY_HUB_FORM);

  // Hub edit
  const [editingHubId, setEditingHubId] = useState<string | null>(null);
  const [hubEdit, setHubEdit] = useState<HubForm>(EMPTY_HUB_FORM);

  // Host add (keyed by hubId)
  const [addingHostHubId, setAddingHostHubId] = useState<string | null>(null);
  const [newHost, setNewHost] = useState<HostForm>(EMPTY_HOST_FORM);

  // Host edit (keyed by hostId)
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [hostEdit, setHostEdit] = useState<HostForm>(EMPTY_HOST_FORM);

  // Host events dropdown (keyed by hostId)
  const [expandedEventsHostId, setExpandedEventsHostId] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setMessage(msg);
    setError(null);
    setTimeout(() => setMessage(null), 3000);
  }, []);

  const fetchHubs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/hubs');
      if (res.ok) {
        const data = await res.json();
        setHubs(data.hubs ?? []);
      } else {
        setError('Failed to load hubs');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Request failed (${res.status})`);
        return false;
      }
      return true;
    } catch {
      setError('Network error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---- Hub create ----
  async function createHub() {
    if (!newHub.slug || !newHub.name || !newHub.startDate || !newHub.endDate) {
      setError('Slug, name, start and end are required to create a hub.');
      return;
    }
    const ok = await send('/api/admin/hubs', 'POST', {
      slug: newHub.slug.trim(),
      name: newHub.name.trim(),
      tagline: newHub.tagline || undefined,
      description: newHub.description || undefined,
      start: dateToStartIso(newHub.startDate),
      end: dateToEndIso(newHub.endDate),
      timezone: newHub.timezone || undefined,
      location: newHub.location || undefined,
      status: newHub.status,
      theme: newHub.theme || undefined,
    });
    if (ok) {
      flash('Hub created');
      setCreatingHub(false);
      setNewHub(EMPTY_HUB_FORM);
      fetchHubs();
    }
  }

  // ---- Hub edit ----
  function startEditHub(hub: HubRow) {
    setEditingHubId(hub.id);
    setHubEdit({
      slug: hub.slug,
      name: hub.name,
      tagline: hub.tagline ?? '',
      description: hub.description ?? '',
      startDate: isoToDate(hub.start),
      endDate: isoToDate(hub.end),
      timezone: hub.timezone ?? '',
      location: hub.location ?? '',
      status: (STATUS_OPTIONS.includes(hub.status as never)
        ? hub.status
        : 'DRAFT') as (typeof STATUS_OPTIONS)[number],
      theme: hub.theme ?? '',
    });
  }

  async function saveHub(hubId: string) {
    const ok = await send(`/api/admin/hubs/${hubId}`, 'PATCH', {
      name: hubEdit.name.trim(),
      tagline: hubEdit.tagline || null,
      description: hubEdit.description || null,
      start: hubEdit.startDate ? dateToStartIso(hubEdit.startDate) : undefined,
      end: hubEdit.endDate ? dateToEndIso(hubEdit.endDate) : undefined,
      timezone: hubEdit.timezone || null,
      location: hubEdit.location || null,
      status: hubEdit.status,
      theme: hubEdit.theme || null,
    });
    if (ok) {
      flash('Hub updated');
      setEditingHubId(null);
      fetchHubs();
    }
  }

  async function quickStatus(hubId: string, status: string) {
    const ok = await send(`/api/admin/hubs/${hubId}`, 'PATCH', { status });
    if (ok) {
      flash('Status updated');
      fetchHubs();
    }
  }

  // ---- Host add ----
  function startAddHost(hubId: string) {
    setAddingHostHubId(hubId);
    setNewHost(EMPTY_HOST_FORM);
  }

  async function createHost(hubId: string) {
    if (!newHost.slug || !newHost.name) {
      setError('Host slug and name are required.');
      return;
    }
    const ok = await send(`/api/admin/hubs/${hubId}/hosts`, 'POST', {
      slug: newHost.slug.trim(),
      name: newHost.name.trim(),
      logoUrl: newHost.logoUrl || null,
      websiteUrl: newHost.websiteUrl || null,
      description: newHost.description || null,
      sourceAlias: newHost.sourceAlias || null,
      featured: newHost.featured,
      sortOrder: Number(newHost.sortOrder) || 0,
    });
    if (ok) {
      flash('Host added');
      setAddingHostHubId(null);
      fetchHubs();
    }
  }

  // ---- Host edit ----
  function startEditHost(host: HubHost) {
    setEditingHostId(host.id);
    setExpandedEventsHostId(host.id);
    setHostEdit({
      slug: host.slug,
      name: host.name,
      logoUrl: host.logoUrl ?? '',
      websiteUrl: host.websiteUrl ?? '',
      description: host.description ?? '',
      sourceAlias: host.sourceAlias ?? '',
      featured: host.featured,
      sortOrder: host.sortOrder,
    });
  }

  async function saveHost(hostId: string) {
    const ok = await send(`/api/admin/hub-hosts/${hostId}`, 'PATCH', {
      name: hostEdit.name.trim(),
      logoUrl: hostEdit.logoUrl || null,
      websiteUrl: hostEdit.websiteUrl || null,
      description: hostEdit.description || null,
      sourceAlias: hostEdit.sourceAlias || null,
      featured: hostEdit.featured,
      sortOrder: Number(hostEdit.sortOrder) || 0,
    });
    if (ok) {
      flash('Host updated');
      setEditingHostId(null);
      fetchHubs();
    }
  }

  async function toggleFeatured(host: HubHost) {
    const ok = await send(`/api/admin/hub-hosts/${host.id}`, 'PATCH', {
      featured: !host.featured,
    });
    if (ok) fetchHubs();
  }

  async function deleteHost(host: HubHost) {
    if (!confirm(`Delete host "${host.name}"? Events stay but lose their host link.`)) return;
    const ok = await send(`/api/admin/hub-hosts/${host.id}`, 'DELETE');
    if (ok) {
      flash('Host deleted');
      if (expandedEventsHostId === host.id) setExpandedEventsHostId(null);
      fetchHubs();
    }
  }

  function toggleEventsPanel(hostId: string) {
    setExpandedEventsHostId((current) => (current === hostId ? null : hostId));
  }

  function renderHostEventsSection(host: HubHost, hubSlug: string, forceExpanded = false) {
    const expanded = forceExpanded || expandedEventsHostId === host.id;
    return (
      <HostEventsSection
        hostId={host.id}
        hostName={host.name}
        hubSlug={hubSlug}
        hostSlug={host.slug}
        expanded={expanded}
        onEditEvent={onEditEvent}
        onDeleteEvent={onDeleteEvent}
        onBulkApplied={onBulkApplied}
        refreshKey={eventListRefreshKey}
      />
    );
  }

  if (loading) {
    return <p className="text-gray-600 dark:text-gray-400">Loading hubs…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
          Manage festival hubs and hosts. Expand <strong>Events</strong> under any host to view and
          edit its published and pending events. Scrape, CSV import, and schedule import remain on
          the Events tab.
        </p>
        <button
          onClick={() => {
            setCreatingHub((v) => !v);
            setNewHub(EMPTY_HUB_FORM);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
        >
          {creatingHub ? 'Cancel' : '+ New Hub'}
        </button>
      </div>

      {message && <p className="text-green-700 dark:text-green-400 text-sm">{message}</p>}
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {creatingHub && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/50 dark:bg-blue-900/10">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Create a new hub</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Slug (URL, e.g. ces-2027)">
              <input
                className={inputClass()}
                value={newHub.slug}
                onChange={(e) => setNewHub({ ...newHub, slug: e.target.value })}
                placeholder="ces-2027"
              />
            </Field>
            <Field label="Name">
              <input
                className={inputClass()}
                value={newHub.name}
                onChange={(e) => setNewHub({ ...newHub, name: e.target.value })}
                placeholder="CES 2027"
              />
            </Field>
            <Field label="Start date">
              <input
                type="date"
                className={inputClass()}
                value={newHub.startDate}
                onChange={(e) => setNewHub({ ...newHub, startDate: e.target.value })}
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                className={inputClass()}
                value={newHub.endDate}
                onChange={(e) => setNewHub({ ...newHub, endDate: e.target.value })}
              />
            </Field>
            <Field label="Timezone (e.g. America/Los_Angeles)">
              <input
                className={inputClass()}
                value={newHub.timezone}
                onChange={(e) => setNewHub({ ...newHub, timezone: e.target.value })}
                placeholder="America/Los_Angeles"
              />
            </Field>
            <Field label="Location">
              <input
                className={inputClass()}
                value={newHub.location}
                onChange={(e) => setNewHub({ ...newHub, location: e.target.value })}
                placeholder="Las Vegas, NV"
              />
            </Field>
            <Field label="Status">
              <select
                className={inputClass()}
                value={newHub.status}
                onChange={(e) =>
                  setNewHub({ ...newHub, status: e.target.value as (typeof STATUS_OPTIONS)[number] })
                }
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tagline">
              <input
                className={inputClass()}
                value={newHub.tagline}
                onChange={(e) => setNewHub({ ...newHub, tagline: e.target.value })}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea
                  className={inputClass()}
                  rows={2}
                  value={newHub.description}
                  onChange={(e) => setNewHub({ ...newHub, description: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Theme (raw JSON, e.g. {&quot;accentColor&quot;:&quot;#0B2A66&quot;})">
                <textarea
                  className={inputClass('font-mono')}
                  rows={2}
                  value={newHub.theme}
                  onChange={(e) => setNewHub({ ...newHub, theme: e.target.value })}
                  placeholder='{"accentColor":"#0B2A66","heroImage":"/cannes.jpg"}'
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={createHub}
              disabled={busy}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              Create hub
            </button>
          </div>
        </div>
      )}

      {hubs.map((hub) => (
        <div
          key={hub.id}
          className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{hub.name}</h3>
              <p className="text-sm text-gray-500">
                {hub.slug} · {hub._count.events} events · {hub.hosts.length} hosts
              </p>
              <Link
                href={`/hubs/${hub.slug}`}
                className="text-sm text-tmc-blue hover:underline"
                target="_blank"
              >
                View public page →
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Status</label>
              <select
                value={hub.status}
                onChange={(e) => quickStatus(hub.id, e.target.value)}
                disabled={busy}
                className="border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => (editingHubId === hub.id ? setEditingHubId(null) : startEditHub(hub))}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                {editingHubId === hub.id ? 'Close' : 'Edit'}
              </button>
            </div>
          </div>

          {editingHubId === hub.id && (
            <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Slug (not editable)">
                  <input className={inputClass('opacity-60')} value={hubEdit.slug} disabled />
                </Field>
                <Field label="Name">
                  <input
                    className={inputClass()}
                    value={hubEdit.name}
                    onChange={(e) => setHubEdit({ ...hubEdit, name: e.target.value })}
                  />
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    className={inputClass()}
                    value={hubEdit.startDate}
                    onChange={(e) => setHubEdit({ ...hubEdit, startDate: e.target.value })}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    className={inputClass()}
                    value={hubEdit.endDate}
                    onChange={(e) => setHubEdit({ ...hubEdit, endDate: e.target.value })}
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    className={inputClass()}
                    value={hubEdit.timezone}
                    onChange={(e) => setHubEdit({ ...hubEdit, timezone: e.target.value })}
                  />
                </Field>
                <Field label="Location">
                  <input
                    className={inputClass()}
                    value={hubEdit.location}
                    onChange={(e) => setHubEdit({ ...hubEdit, location: e.target.value })}
                  />
                </Field>
                <Field label="Tagline">
                  <input
                    className={inputClass()}
                    value={hubEdit.tagline}
                    onChange={(e) => setHubEdit({ ...hubEdit, tagline: e.target.value })}
                  />
                </Field>
                <Field label="Status">
                  <select
                    className={inputClass()}
                    value={hubEdit.status}
                    onChange={(e) =>
                      setHubEdit({
                        ...hubEdit,
                        status: e.target.value as (typeof STATUS_OPTIONS)[number],
                      })
                    }
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Description">
                    <textarea
                      className={inputClass()}
                      rows={2}
                      value={hubEdit.description}
                      onChange={(e) => setHubEdit({ ...hubEdit, description: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Theme (raw JSON)">
                    <textarea
                      className={inputClass('font-mono')}
                      rows={2}
                      value={hubEdit.theme}
                      onChange={(e) => setHubEdit({ ...hubEdit, theme: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => saveHub(hub.id)}
                  disabled={busy}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  Save changes
                </button>
                <button
                  onClick={() => setEditingHubId(null)}
                  className="border border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Hosts</h4>
            <button
              onClick={() => (addingHostHubId === hub.id ? setAddingHostHubId(null) : startAddHost(hub.id))}
              className="text-sm text-blue-600 hover:underline"
            >
              {addingHostHubId === hub.id ? 'Cancel' : '+ Add host'}
            </button>
          </div>

          {addingHostHubId === hub.id && (
            <div className="mb-3 border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Slug (e.g. unplugged-collective)">
                  <input
                    className={inputClass()}
                    value={newHost.slug}
                    onChange={(e) => setNewHost({ ...newHost, slug: e.target.value })}
                  />
                </Field>
                <Field label="Name">
                  <input
                    className={inputClass()}
                    value={newHost.name}
                    onChange={(e) => setNewHost({ ...newHost, name: e.target.value })}
                  />
                </Field>
                <Field label="Source alias (matches event source for auto-assign)">
                  <input
                    className={inputClass()}
                    value={newHost.sourceAlias}
                    onChange={(e) => setNewHost({ ...newHost, sourceAlias: e.target.value })}
                  />
                </Field>
                <Field label="Website URL">
                  <input
                    className={inputClass()}
                    value={newHost.websiteUrl}
                    onChange={(e) => setNewHost({ ...newHost, websiteUrl: e.target.value })}
                  />
                </Field>
                <Field label="Logo URL">
                  <input
                    className={inputClass()}
                    value={newHost.logoUrl}
                    onChange={(e) => setNewHost({ ...newHost, logoUrl: e.target.value })}
                  />
                </Field>
                <Field label="Sort order">
                  <input
                    type="number"
                    className={inputClass()}
                    value={newHost.sortOrder}
                    onChange={(e) => setNewHost({ ...newHost, sortOrder: Number(e.target.value) })}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Description">
                    <textarea
                      className={inputClass()}
                      rows={2}
                      value={newHost.description}
                      onChange={(e) => setNewHost({ ...newHost, description: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={newHost.featured}
                    onChange={(e) => setNewHost({ ...newHost, featured: e.target.checked })}
                  />
                  Featured
                </label>
              </div>
              <div className="mt-3">
                <button
                  onClick={() => createHost(hub.id)}
                  disabled={busy}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  Add host
                </button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
            {hub.hosts.map((host) => (
              <li key={host.id} className="py-2">
                {editingHostId === host.id ? (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/40">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Slug (not editable)">
                        <input className={inputClass('opacity-60')} value={hostEdit.slug} disabled />
                      </Field>
                      <Field label="Name">
                        <input
                          className={inputClass()}
                          value={hostEdit.name}
                          onChange={(e) => setHostEdit({ ...hostEdit, name: e.target.value })}
                        />
                      </Field>
                      <Field label="Source alias">
                        <input
                          className={inputClass()}
                          value={hostEdit.sourceAlias}
                          onChange={(e) => setHostEdit({ ...hostEdit, sourceAlias: e.target.value })}
                        />
                      </Field>
                      <Field label="Website URL">
                        <input
                          className={inputClass()}
                          value={hostEdit.websiteUrl}
                          onChange={(e) => setHostEdit({ ...hostEdit, websiteUrl: e.target.value })}
                        />
                      </Field>
                      <Field label="Logo URL">
                        <input
                          className={inputClass()}
                          value={hostEdit.logoUrl}
                          onChange={(e) => setHostEdit({ ...hostEdit, logoUrl: e.target.value })}
                        />
                      </Field>
                      <Field label="Sort order">
                        <input
                          type="number"
                          className={inputClass()}
                          value={hostEdit.sortOrder}
                          onChange={(e) => setHostEdit({ ...hostEdit, sortOrder: Number(e.target.value) })}
                        />
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="Description">
                          <textarea
                            className={inputClass()}
                            rows={2}
                            value={hostEdit.description}
                            onChange={(e) => setHostEdit({ ...hostEdit, description: e.target.value })}
                          />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={hostEdit.featured}
                          onChange={(e) => setHostEdit({ ...hostEdit, featured: e.target.checked })}
                        />
                        Featured
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => saveHost(host.id)}
                        disabled={busy}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingHostId(null)}
                        className="border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      >
                        Cancel
                      </button>
                    </div>
                    {renderHostEventsSection(host, hub.slug, true)}
                  </div>
                ) : (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-gray-800 dark:text-gray-200">
                        {host.name} <span className="text-gray-400">({host.slug})</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          {host._count?.events ?? 0} events
                        </span>
                        {host.featured && (
                          <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 rounded">
                            featured
                          </span>
                        )}
                        {host.sourceAlias && (
                          <span className="ml-2 text-gray-400 text-xs">source: {host.sourceAlias}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => toggleEventsPanel(host.id)}
                          className="text-gray-700 dark:text-gray-300 hover:underline font-medium"
                        >
                          {expandedEventsHostId === host.id ? '▾' : '▸'} Events (
                          {host._count?.events ?? 0})
                        </button>
                        <button
                          onClick={() => toggleFeatured(host)}
                          disabled={busy}
                          className="text-amber-600 hover:underline"
                        >
                          {host.featured ? 'Unfeature' : 'Feature'}
                        </button>
                        <button
                          onClick={() => startEditHost(host)}
                          className="text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteHost(host)}
                          disabled={busy}
                          className="text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                    {renderHostEventsSection(host, hub.slug)}
                  </div>
                )}
              </li>
            ))}
            {hub.hosts.length === 0 && (
              <li className="py-2 text-gray-400">No hosts yet — add one above.</li>
            )}
          </ul>
        </div>
      ))}

      {hubs.length === 0 && !creatingHub && (
        <p className="text-gray-500">
          No hubs yet. Click <strong>+ New Hub</strong> above, or run{' '}
          <code>npm run seed:cannes-hub</code> to create Cannes 2026.
        </p>
      )}
    </div>
  );
}
