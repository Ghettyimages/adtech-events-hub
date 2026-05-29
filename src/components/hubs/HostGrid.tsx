'use client';

import { useMemo, useState } from 'react';
import type { HubHostSummary } from '@/lib/hubs-client';
import HostCard from './HostCard';

interface HostGridProps {
  hubSlug: string;
  hosts: HubHostSummary[];
}

export default function HostGrid({ hubSlug, hosts }: HostGridProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.slug.toLowerCase().includes(q)
    );
  }, [hosts, search]);

  const featured = filtered.filter((h) => h.featured);
  const rest = filtered.filter((h) => !h.featured);

  return (
    <div>
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search hosts or events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-h-[44px]"
        />
      </div>

      {featured.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Featured hosts</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {featured.map((host) => (
              <HostCard key={host.id} hubSlug={hubSlug} host={host} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">All hosts</h2>
        {rest.length === 0 && featured.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No hosts match your search.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {rest.map((host) => (
              <HostCard key={host.id} hubSlug={hubSlug} host={host} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
