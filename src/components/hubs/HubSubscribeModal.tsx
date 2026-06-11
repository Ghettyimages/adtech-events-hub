'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import CalendarInstructions from '@/components/CalendarInstructions';

interface HubSubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  hubSlug: string;
  hubName: string;
  hostSlugs?: string[];
  feedToken: string | null | undefined;
}

export default function HubSubscribeModal({
  isOpen,
  onClose,
  hubSlug,
  hubName,
  hostSlugs,
  feedToken,
}: HubSubscribeModalProps) {
  const { status } = useSession();
  const [consentChecked, setConsentChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [showIcalOptions, setShowIcalOptions] = useState(false);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [eventsMatched, setEventsMatched] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (showSuccess && status === 'authenticated') {
      fetch(`/api/mine/gcal/hub/status?hubSlug=${encodeURIComponent(hubSlug)}`)
        .then((r) => r.json())
        .then((d) => setGcalConnected(d.gcalConnected ?? false))
        .catch(() => {});
    }
  }, [showSuccess, status, hubSlug]);

  if (!isOpen || !mounted) return null;

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const hubFeedUrl =
    feedToken && siteUrl
      ? `${siteUrl}/api/feed/hub?token=${feedToken}&hub=${hubSlug}`
      : null;

  const scopeLabel =
    hostSlugs && hostSlugs.length === 1
      ? 'this host'
      : hostSlugs && hostSlugs.length > 1
        ? 'selected hosts'
        : 'all events in this hub';

  const handleSubmit = async () => {
    if (status !== 'authenticated') {
      signIn(undefined, { callbackUrl: window.location.href });
      return;
    }
    if (!consentChecked) {
      setError('You must agree to the Terms of Service to subscribe.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const filter: Record<string, unknown> = { hubSlug };
      if (hostSlugs && hostSlugs.length > 0) {
        filter.hostSlugs = hostSlugs;
      }

      const res = await fetch('/api/subscriptions/hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, acceptTerms: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Subscription failed');
      }
      setEventsMatched(data.stats?.matchCount ?? data.eventsAdded ?? 0);
      setGcalConnected(data.gcalConnected ?? false);
      if (data.gcalSynced) {
        setSyncMessage(`Synced ${data.stats?.matchCount ?? 0} events to Google Calendar.`);
      } else if (data.gcalConnected) {
        setSyncMessage('Subscription active. Syncing to Google Calendar...');
      } else {
        setSyncMessage('Subscribed! Connect Google Calendar to sync events automatically.');
      }
      setShowSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConnectGoogle = () => {
    signIn('google', {
      callbackUrl: `${window.location.href}${window.location.search ? '&' : '?'}gcal=connected`,
      redirect: true,
    });
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncMessage('');
    try {
      await fetch('/api/mine/gcal/hub/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubSlug }),
      });
      const res = await fetch('/api/mine/gcal/hub/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setGcalConnected(true);
        setSyncMessage(`Synced ${data.synced} event(s) to your ${hubName} calendar.`);
      } else {
        setSyncMessage(data.error || 'Sync failed');
      }
    } catch {
      setSyncMessage('Sync failed. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClose = () => {
    setConsentChecked(false);
    setShowSuccess(false);
    setError('');
    setShowIcalOptions(false);
    setSyncMessage('');
    onClose();
  };

  const modal = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-4 md:p-6 overflow-y-auto flex-1 min-h-0">
          {!showSuccess ? (
            <>
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white pr-2">
                  Subscribe to {hubName}
                </h2>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-gray-400 hover:text-gray-600 text-2xl p-2"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Add {scopeLabel} to a dedicated <strong>{hubName}</strong> calendar in Google
                Calendar. Hub events stay separate from the main Media Calendar.
              </p>
              {status !== 'authenticated' && (
                <p className="mb-4 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-3 rounded">
                  Sign in to subscribe and sync events to your calendar.
                </p>
              )}
              <label className="flex items-start gap-2 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  I agree to the{' '}
                  <Link href="/terms" className="text-tmc-blue hover:underline">
                    Terms of Service
                  </Link>
                </span>
              </label>
              {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-tmc-navy text-white py-3 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 min-h-[44px]"
              >
                {isSubmitting
                  ? 'Subscribing…'
                  : status === 'authenticated'
                    ? 'Subscribe'
                    : 'Sign in to subscribe'}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                You&apos;re subscribed
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {eventsMatched} event{eventsMatched === 1 ? '' : 's'} matched for {scopeLabel}.
              </p>

              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Google Calendar
                </p>
                {gcalConnected ? (
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Events sync to a calendar named <strong>{hubName}</strong> in your Google
                      account.
                    </p>
                    <button
                      type="button"
                      onClick={handleSyncNow}
                      disabled={isSyncing}
                      className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                    >
                      {isSyncing ? 'Syncing…' : 'Sync Now'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Connect Google Calendar to create your <strong>{hubName}</strong> calendar and
                      sync events automatically.
                    </p>
                    <button
                      type="button"
                      onClick={handleConnectGoogle}
                      className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 min-h-[44px]"
                    >
                      Connect Google Calendar
                    </button>
                  </>
                )}
                {syncMessage && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">{syncMessage}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowIcalOptions(!showIcalOptions)}
                className="w-full text-left text-sm text-tmc-blue hover:underline mb-2"
              >
                {showIcalOptions ? 'Hide' : 'Other options: Download iCal feed'}
              </button>

              {showIcalOptions && hubFeedUrl && (
                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    Manual iCal feed (advanced):
                  </p>
                  <code className="block text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded break-all mb-2">
                    {hubFeedUrl}
                  </code>
                  <a
                    href={hubFeedUrl}
                    download="festival-hub.ics"
                    className="inline-block w-full text-center py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 text-sm min-h-[44px]"
                  >
                    Download .ics
                  </a>
                  <div className="mt-3">
                    <CalendarInstructions feedUrl={hubFeedUrl} />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleClose}
                className="w-full border border-gray-300 dark:border-gray-600 py-3 rounded-lg min-h-[44px]"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
