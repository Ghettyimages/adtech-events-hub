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

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const hubFeedUrl =
    feedToken && siteUrl
      ? `${siteUrl}/api/feed/hub?token=${feedToken}&hub=${hubSlug}`
      : null;

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
      setShowSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setConsentChecked(false);
    setShowSuccess(false);
    setError('');
    onClose();
  };

  const scopeLabel =
    hostSlugs && hostSlugs.length === 1
      ? 'this host'
      : hostSlugs && hostSlugs.length > 1
        ? 'selected hosts'
        : 'all events in this hub';

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
                Get an iCal feed for {scopeLabel} at {hubName}. Hub events stay separate from the main
                Media Calendar.
              </p>
              {status !== 'authenticated' && (
                <p className="mb-4 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 p-3 rounded">
                  Sign in to subscribe and get your personal feed URL.
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
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">You&apos;re subscribed</h2>
              {hubFeedUrl && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Your hub calendar feed:</p>
                  <code className="block text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded break-all mb-4">
                    {hubFeedUrl}
                  </code>
                  <CalendarInstructions feedUrl={hubFeedUrl} />
                </>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="mt-4 w-full border border-gray-300 dark:border-gray-600 py-3 rounded-lg min-h-[44px]"
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
