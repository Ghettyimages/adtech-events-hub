'use client';

import Link from 'next/link';
import { useState } from 'react';
import { format } from 'date-fns';
import type { HubHostSummary, HubPreviewEvent } from '@/lib/hubs-client';

interface HostCardProps {
  hubSlug: string;
  host: HubHostSummary;
}

export default function HostCard({ hubSlug, host }: HostCardProps) {
  const [preview, setPreview] = useState<HubPreviewEvent[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const href = `/hubs/${hubSlug}/${host.slug}`;

  const loadPreview = async () => {
    if (preview !== null || loadingPreview) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/hubs/${hubSlug}/hosts/${host.slug}/preview`);
      if (res.ok) {
        const data = await res.json();
        setPreview(data.events ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <div
      className="relative"
      onMouseEnter={loadPreview}
    >
      <Link
        href={href}
        className="block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-[var(--hub-accent,#C9A227)] transition min-h-[120px]"
      >
        <div className="flex flex-col items-center text-center gap-3">
          {host.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={host.logoUrl}
              alt=""
              className="h-12 w-12 object-contain rounded"
            />
          ) : (
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
              style={{ background: 'var(--hub-accent, #C9A227)' }}
            >
              {host.name.charAt(0)}
            </div>
          )}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{host.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {host.eventCount} {host.eventCount === 1 ? 'event' : 'events'}
            </p>
          </div>
        </div>
      </Link>

      {/* Desktop hover popover */}
      {(preview?.length ?? 0) > 0 && (
        <div className="hidden md:block absolute z-20 left-1/2 -translate-x-1/2 top-full mt-2 w-72 pointer-events-none">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 text-left">
            <p className="font-semibold text-sm text-gray-900 dark:text-white mb-2">{host.name}</p>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              {preview!.map((ev) => (
                <li key={ev.id}>
                  <span className="text-gray-400 dark:text-gray-500">
                    {format(new Date(ev.start), 'EEE MMM d · h:mm a')}
                  </span>
                  <br />
                  {ev.title}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--hub-accent,#C9A227)] mt-2 font-medium">View all events →</p>
          </div>
        </div>
      )}
    </div>
  );
}
