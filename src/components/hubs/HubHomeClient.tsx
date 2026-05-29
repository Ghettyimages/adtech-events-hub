'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import type { HubSummary } from '@/lib/hubs-client';
import HubThemeWrapper from './HubThemeWrapper';
import HubHero from './HubHero';
import HostGrid from './HostGrid';
import HubSubscribeModal from './HubSubscribeModal';

interface HubHomeClientProps {
  hub: HubSummary;
}

export default function HubHomeClient({ hub }: HubHomeClientProps) {
  const { data: session } = useSession();
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

        <HubHero
          hub={hub}
          onSubscribe={() => setShowSubscribe(true)}
          subscribeLabel={`Subscribe to ${hub.theme?.label ?? hub.name}`}
        />

        <HostGrid hubSlug={hub.slug} hosts={hub.hosts} />

        <HubSubscribeModal
          isOpen={showSubscribe}
          onClose={() => setShowSubscribe(false)}
          hubSlug={hub.slug}
          hubName={hub.name}
          feedToken={feedToken}
        />
      </div>
    </HubThemeWrapper>
  );
}
