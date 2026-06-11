'use client';

import type { Event } from '@prisma/client';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { downloadEventIcs } from '@/lib/downloadIcs';
import { TEMPORAL_KIND } from '@/lib/eventTemporal';

export interface HubCalendarStatus {
  gcalConnected: boolean;
  hubGcalProvisioned: boolean;
  inScopeEventIds: string[];
  syncedEventIds: string[];
}

interface HubAddToCalendarLinkProps {
  event: Event;
  hubSlug: string;
  hubName: string;
  hubStatus?: HubCalendarStatus | null;
  compact?: boolean;
  onFollowSuccess?: () => void;
}

export default function HubAddToCalendarLink({
  event,
  hubSlug,
  hubName,
  hubStatus,
  compact = false,
  onFollowSuccess,
}: HubAddToCalendarLinkProps) {
  const { status } = useSession();
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const gcalConnected = hubStatus?.gcalConnected ?? false;
  const isAllDayHubEvent = event.temporalKind === TEMPORAL_KIND.ALL_DAY;
  const eventInScope =
    !isAllDayHubEvent && (hubStatus?.inScopeEventIds.includes(event.id) ?? false);
  const eventInCalendar = eventInScope && gcalConnected;

  if (isAllDayHubEvent) {
    return (
      <span
        className={
          compact
            ? 'inline-flex items-center justify-center px-4 py-2.5 rounded-lg text-sm text-white/60 border border-white/20 min-h-[44px]'
            : 'text-sm text-gray-500 dark:text-gray-400'
        }
        title="Date-only events are not synced to Google Calendar"
      >
        {compact ? 'Date only' : 'Date only — not synced to calendar'}
      </span>
    );
  }

  const handleAddToCalendar = async () => {
    if (!gcalConnected) {
      const callbackUrl = `${window.location.origin}${window.location.pathname}?gcal=connected`;
      signIn('google', { callbackUrl, redirect: true });
      return;
    }
    setAddError(null);
    setAddSuccess(false);
    setIsAdding(true);
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, acceptTerms: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setAddSuccess(true);
        onFollowSuccess?.();
        await fetch('/api/mine/gcal/hub/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hubSlug }),
        });
      } else {
        setAddError(data.error || 'Failed to add to calendar');
      }
    } catch {
      setAddError('An error occurred. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncError(null);
    setSyncSuccess(false);
    setIsSyncing(true);
    try {
      const res = await fetch('/api/mine/gcal/hub/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncSuccess(true);
        onFollowSuccess?.();
      } else {
        setSyncError(data.error || 'Sync failed');
      }
    } catch {
      setSyncError('An error occurred. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownloadIcs = () => {
    downloadEventIcs(event, hubName);
  };

  const compactBtn =
    'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition min-h-[44px] flex-1 sm:flex-none';
  const accentStyle = { background: 'var(--hub-accent, #C9A227)' };

  if (status === 'unauthenticated') {
    return (
      <button
        type="button"
        onClick={() =>
          router.push(`/login?callbackUrl=${encodeURIComponent(window.location.href)}`)
        }
        className={`${compactBtn} text-white border-2 border-white/40 bg-white/10 hover:bg-white/20`}
      >
        Sign in to add
      </button>
    );
  }

  if (status !== 'authenticated') {
    return (
      <span className={`${compactBtn} text-white/70 border border-white/20`}>
        Loading...
      </span>
    );
  }

  if (eventInCalendar) {
    if (compact) {
      return (
        <button
          type="button"
          onClick={handleSyncNow}
          disabled={isSyncing}
          className={`${compactBtn} text-tmc-navy hover:opacity-90 disabled:opacity-50`}
          style={accentStyle}
          title={`In your ${hubName} calendar`}
        >
          {isSyncing ? 'Syncing...' : 'In your calendar'}
        </button>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          <p className="font-medium text-gray-900 dark:text-white">
            This event is in your {hubName} calendar.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Don&apos;t see it? Run a manual sync.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link
              href="/subscriptions"
              className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold text-sm"
            >
              My Subscriptions
            </Link>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center justify-center px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-semibold text-sm disabled:opacity-50"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          {syncSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-2">
              Calendar synced.
            </p>
          )}
          {syncError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{syncError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="w-full inline-flex items-center justify-center px-4 py-3 min-h-[44px] bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          Download .ics
        </button>
      </div>
    );
  }

  if (eventInScope && !gcalConnected) {
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: window.location.href, redirect: true })}
          className={`${compactBtn} text-tmc-navy hover:opacity-90`}
          style={accentStyle}
        >
          Connect Google
        </button>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          <p className="font-medium text-gray-900 dark:text-white">
            Subscribed — connect Google Calendar to sync {hubName} events.
          </p>
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: window.location.href, redirect: true })}
            className="mt-3 w-full inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Connect Google Calendar
          </button>
        </div>
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="w-full inline-flex items-center justify-center px-4 py-3 min-h-[44px] bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          Download .ics
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? 'contents' : 'space-y-3'}>
      <button
        type="button"
        onClick={handleAddToCalendar}
        disabled={isAdding}
        className={
          compact
            ? `${compactBtn} text-tmc-navy hover:opacity-90 disabled:opacity-50`
            : 'inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 min-h-[44px]'
        }
        style={compact ? accentStyle : undefined}
      >
        {isAdding ? 'Adding...' : compact ? 'Add to calendar' : `Add to ${hubName}`}
      </button>
      {!compact && (
        <>
          <button
            type="button"
            onClick={handleDownloadIcs}
            className="inline-flex items-center justify-center px-4 py-3 min-h-[44px] w-full sm:w-auto bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
          >
            Download .ics
          </button>
          {addSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">
              Event added to your {hubName} calendar.
            </p>
          )}
          {addError && (
            <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>
          )}
        </>
      )}
    </div>
  );
}
