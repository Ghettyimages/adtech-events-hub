'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { HubSummary } from '@/lib/hubs-client';
import HubThemeWrapper from './HubThemeWrapper';
import HubHero from './HubHero';
import HostGrid from './HostGrid';
import HubSubscribeModal from './HubSubscribeModal';
import { useHubCalendarStatus } from './useHubCalendarStatus';
import AddToItineraryButton from '@/components/itinerary/AddToItineraryButton';
import { ITINERARY_ITEM_KIND } from '@/lib/itineraryConstants';

interface HubHomeClientProps {
  hub: HubSummary;
}

export default function HubHomeClient({ hub }: HubHomeClientProps) {
  const { hubSubscriptionActive, feedToken, refreshHubStatus } =
    useHubCalendarStatus(hub.slug);
  const [showSubscribe, setShowSubscribe] = useState(false);

  return (
    <HubThemeWrapper theme={hub.theme}>
      <div className="container mx-auto px-4 py-6 md:py-8">
        <nav className="mb-6 text-sm">
          <Link href="/" className="text-tmc-blue hover:underline">
            Calendar
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <Link href="/hubs" className="text-tmc-blue hover:underline">
            Festival Hubs
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-600 dark:text-gray-400">{hub.name}</span>
        </nav>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <AddToItineraryButton
            payload={{
              kind: ITINERARY_ITEM_KIND.HUB,
              hubId: hub.id,
              label: hub.name,
            }}
            hubSlug={hub.slug}
          />
        </div>

        <HubHero
          hub={hub}
          onSubscribe={() => setShowSubscribe(true)}
          subscribeLabel={
            hubSubscriptionActive
              ? `Subscribed to ${hub.theme?.label ?? hub.name}`
              : `Subscribe to ${hub.theme?.label ?? hub.name}`
          }
        />

        <HostGrid hubSlug={hub.slug} hosts={hub.hosts} />

        <HubSubscribeModal
          isOpen={showSubscribe}
          onClose={() => {
            setShowSubscribe(false);
            refreshHubStatus();
          }}
          hubSlug={hub.slug}
          hubName={hub.name}
          feedToken={feedToken}
        />
      </div>
    </HubThemeWrapper>
  );
}
