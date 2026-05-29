'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Event } from '@prisma/client';
import type { HubTheme } from '@/lib/hubs-client';
import HubThemeWrapper from './HubThemeWrapper';
import HostTimeline, { type HubEventRow } from './HostTimeline';
import HubSubscribeModal from './HubSubscribeModal';
import EventCard from '@/components/EventCard';

interface HostPageClientProps {
  hubSlug: string;
  hubName: string;
  theme?: HubTheme;
  host: {
    slug: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    description: string | null;
    eventCount: number;
  };
  events: HubEventRow[];
}

export default function HostPageClient({
  hubSlug,
  hubName,
  theme,
  host,
  events,
}: HostPageClientProps) {
  const { data: session } = useSession();
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [feedToken, setFeedToken] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) {
      fetch('/api/subscriptions/status')
        .then((r) => r.json())
        .then((d) => setFeedToken(d.feedToken ?? null))
        .catch(() => {});
    }
  }, [session]);

  return (
    <HubThemeWrapper theme={theme}>
      <div className="container mx-auto px-4 py-6 md:py-8">
        <nav className="mb-6 text-sm">
          <Link href={`/hubs/${hubSlug}`} className="text-tmc-blue hover:underline">
            {hubName}
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-600 dark:text-gray-400">{host.name}</span>
        </nav>

        <header className="flex flex-col md:flex-row md:items-start gap-6 mb-8">
          <div className="flex items-start gap-4 flex-1">
            {host.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={host.logoUrl} alt="" className="h-16 w-16 object-contain rounded" />
            ) : (
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: 'var(--hub-accent, #C9A227)' }}
              >
                {host.name.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">{host.name}</h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                {host.eventCount} {host.eventCount === 1 ? 'event' : 'events'}
              </p>
              {host.description && (
                <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-2xl">{host.description}</p>
              )}
              {host.websiteUrl && (
                <a
                  href={host.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 text-tmc-blue hover:underline text-sm"
                >
                  Website ↗
                </a>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSubscribe(true)}
            className="shrink-0 bg-tmc-navy text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 min-h-[44px]"
          >
            Subscribe to this host
          </button>
        </header>

        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`px-4 py-2 rounded-lg min-h-[44px] ${
              viewMode === 'timeline'
                ? 'bg-tmc-navy text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded-lg min-h-[44px] ${
              viewMode === 'list'
                ? 'bg-tmc-navy text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            List
          </button>
        </div>

        {viewMode === 'timeline' ? (
          <HostTimeline
            events={events}
            onSelectEvent={(ev) => setSelectedEvent(ev as unknown as Event)}
          />
        ) : (
          <HostTimeline events={events} onSelectEvent={(ev) => setSelectedEvent(ev as unknown as Event)} />
        )}

        {selectedEvent && (
          <EventCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
        )}

        <HubSubscribeModal
          isOpen={showSubscribe}
          onClose={() => setShowSubscribe(false)}
          hubSlug={hubSlug}
          hubName={hubName}
          hostSlugs={[host.slug]}
          feedToken={feedToken}
        />
      </div>
    </HubThemeWrapper>
  );
}
