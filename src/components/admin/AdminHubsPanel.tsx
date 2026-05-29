'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface HubHost {
  id: string;
  slug: string;
  name: string;
  featured: boolean;
  sourceAlias: string | null;
}

interface HubRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  start: string;
  end: string;
  hosts: HubHost[];
  _count: { events: number };
}

export default function AdminHubsPanel() {
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const fetchHubs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/hubs');
      if (res.ok) {
        const data = await res.json();
        setHubs(data.hubs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  const updateHubStatus = async (hubId: string, status: string) => {
    const res = await fetch(`/api/admin/hubs/${hubId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setMessage('Hub updated');
      fetchHubs();
    }
  };

  if (loading) {
    return <p className="text-gray-600 dark:text-gray-400">Loading hubs…</p>;
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="text-green-700 dark:text-green-400 text-sm">{message}</p>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Manage festival hubs and hosts. Assign events to a hub from the Events tab via hub fields on
        edit, or use CSV columns <code className="bg-gray-100 dark:bg-gray-800 px-1">hub_slug</code>{' '}
        and <code className="bg-gray-100 dark:bg-gray-800 px-1">host_slug</code>.
      </p>

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
                onChange={(e) => updateHubStatus(hub.id, e.target.value)}
                className="border rounded px-2 py-1 text-sm dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="DRAFT">DRAFT</option>
                <option value="UPCOMING">UPCOMING</option>
                <option value="LIVE">LIVE</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </div>
          </div>

          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Hosts</h4>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
            {hub.hosts.map((host) => (
              <li key={host.id} className="py-2 flex justify-between gap-2">
                <span>
                  {host.name}{' '}
                  <span className="text-gray-400">({host.slug})</span>
                  {host.featured && (
                    <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 rounded">
                      featured
                    </span>
                  )}
                </span>
                {host.sourceAlias && (
                  <span className="text-gray-400 text-xs">source: {host.sourceAlias}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hubs.length === 0 && (
        <p className="text-gray-500">
          No hubs yet. Run <code>npm run seed:cannes-hub</code> to create Cannes 2026.
        </p>
      )}
    </div>
  );
}
