'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import CalendarInstructions from './CalendarInstructions';

interface SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  feedToken: string | null | undefined;
  subscriptionType: 'full' | 'custom';
}

export default function SubscribeModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  feedToken,
  subscriptionType,
}: SubscribeModalProps) {
  const [consentChecked, setConsentChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const fullFeedUrl = feedToken ? `${siteUrl}/api/feed/full?token=${feedToken}` : null;
  const customFeedUrl = feedToken ? `${siteUrl}/api/feed/custom?token=${feedToken}` : null;

  const handleSubmit = async () => {
    if (!consentChecked) {
      setError('You must agree to the Terms of Service to subscribe.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onConfirm();
      setShowSuccess(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
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

  const modalContent = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-4 md:p-6 overflow-y-auto flex-1 min-h-0">
          {!showSuccess ? (
            <>
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white pr-2">{title}</h2>
                <button
                  onClick={handleClose}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl p-3 -m-3 min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <p className="text-gray-600 dark:text-gray-400 mb-6">{description}</p>

              <div className="space-y-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                      className="mt-1 mr-3 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      I agree to the{' '}
                      <Link
                        href="/terms"
                        target="_blank"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link
                        href="/privacy"
                        target="_blank"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Privacy Policy
                      </Link>{' '}
                      and consent to email/calendar notifications about my subscriptions.
                    </span>
                  </label>
                </div>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!consentChecked || isSubmitting}
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Subscribing...' : 'Subscribe'}
                  </button>
                  <button
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-semibold disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 text-center">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-green-600 dark:text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                Subscription Active!
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4 text-center">
                Your subscription is live. To add this calendar to your calendar app, follow the instructions below.
              </p>

                {feedToken && (
                  <div className="space-y-4 mb-6">
                    {subscriptionType === 'full' && fullFeedUrl && (
                      <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                          Full Calendar Feed URL:
                        </h3>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={fullFeedUrl}
                            readOnly
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(fullFeedUrl);
                              alert('Feed URL copied to clipboard!');
                            }}
                            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}

                    {subscriptionType === 'custom' && customFeedUrl && (
                      <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                          Custom Calendar Feed URL:
                        </h3>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customFeedUrl}
                            readOnly
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white"
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(customFeedUrl);
                              alert('Feed URL copied to clipboard!');
                            }}
                            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      Anyone with this URL can access your feed. Treat it as confidential.
                    </p>

                    <div className="mt-4">
                      <CalendarInstructions feedUrl={subscriptionType === 'full' ? fullFeedUrl || undefined : customFeedUrl || undefined} />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <Link
                    href="/subscriptions"
                    onClick={handleClose}
                    className="block w-full text-center px-4 py-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold underline"
                  >
                    View in My Subscriptions →
                  </Link>
                  <button
                    onClick={handleClose}
                    className="w-full bg-blue-600 text-white py-3 px-4 min-h-[44px] rounded-lg hover:bg-blue-700 transition font-semibold"
                  >
                    Done
                  </button>
                </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

