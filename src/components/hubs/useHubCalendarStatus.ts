'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { HubCalendarStatus } from './HubAddToCalendarLink';

export function useHubCalendarStatus(hubSlug: string) {
  const { status } = useSession();
  const [hubStatus, setHubStatus] = useState<HubCalendarStatus | null>(null);
  const [hubSubscriptionActive, setHubSubscriptionActive] = useState(false);
  const [feedToken, setFeedToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (status !== 'authenticated') {
      setHubStatus(null);
      setHubSubscriptionActive(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/subscriptions/hub/status?hubSlug=${encodeURIComponent(hubSlug)}`
      );
      if (res.ok) {
        const d = await res.json();
        setHubStatus({
          gcalConnected: d.gcalConnected ?? false,
          hubGcalProvisioned: d.hubGcalProvisioned ?? false,
          inScopeEventIds: d.inScopeEventIds ?? [],
          syncedEventIds: d.syncedEventIds ?? [],
        });
        setHubSubscriptionActive(d.hubSubscriptionActive ?? false);
        setFeedToken(d.feedToken ?? null);
      }
    } catch {
      /* ignore */
    }
  }, [hubSlug, status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    hubStatus,
    hubSubscriptionActive,
    feedToken,
    refreshHubStatus: refresh,
  };
}
