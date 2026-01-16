'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import CalendarInstructions from '@/components/CalendarInstructions';
import { buildGoogleCalendarSubscribeUrl } from '@/lib/events';

interface Subscription {
  id: string;
  kind: string;
  active: boolean;
  createdAt: string;
}

interface EventFollow {
  id: string;
  eventId: string;
  createdAt: string;
  event: {
    id: string;
    title: string;
    start: string;
    end: string;
    location: string | null;
  };
}

export default function SubscriptionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [eventFollows, setEventFollows] = useState<EventFollow[]>([]);
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/subscriptions');
      return;
    }

    if (status === 'authenticated' && session) {
      fetchSubscriptions();
      checkGoogleCalendarStatus();
    }
  }, [status, session, router]);

  const fetchSubscriptions = async () => {
    try {
      const response = await fetch('/api/subscriptions');
      if (response.ok) {
        const data = await response.json();
        setSubscriptions(data.subscriptions || []);
        setEventFollows(data.eventFollows || []);
        setFeedToken(data.feedToken);
      } else {
        console.error('Failed to fetch subscriptions');
      }
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkGoogleCalendarStatus = async () => {
    try {
      const response = await fetch('/api/mine/gcal/status');
      if (response.ok) {
        const data = await response.json();
        setGcalConnected(data.connected || false);
      }
    } catch (error) {
      console.error('Error checking Google Calendar status:', error);
    }
  };

  const handleConnectGoogleCalendar = () => {
    // Redirect to Google OAuth
    window.location.href = '/api/auth/signin/google';
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/mine/gcal/sync', {
        method: 'POST',
      });

      const data = await response.json();
      if (response.ok) {
        setSyncResult({
          success: true,
          message: data.message || 'Events synced successfully!',
        });
        // Refresh connection status in case token was updated
        await checkGoogleCalendarStatus();
      } else {
        setSyncResult({
          success: false,
          message: data.error || 'Failed to sync events',
        });
      }
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.message || 'An error occurred while syncing',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleFullSubscription = async () => {
    setIsToggling(true);
    try {
      const response = await fetch('/api/subscriptions/full/toggle', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        // Update subscriptions list
        const fullSub = subscriptions.find((s) => s.kind === 'FULL');
        if (fullSub) {
          setSubscriptions(
            subscriptions.map((s) =>
              s.id === fullSub.id ? data.subscription : s
            )
          );
        } else {
          setSubscriptions([...subscriptions, data.subscription]);
        }
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to toggle subscription');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setIsToggling(false);
    }
  };

  const handleUnfollow = async (eventId: string) => {
    setUnfollowingId(eventId);
    try {
      const response = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });

      if (response.ok) {
        setEventFollows(eventFollows.filter((ef) => ef.eventId !== eventId));
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to unfollow event');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setUnfollowingId(null);
    }
  };

  const fullSubscription = subscriptions.find((s) => s.kind === 'FULL');
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const fullFeedUrl = feedToken ? `${siteUrl}/api/feed/full?token=${feedToken}` : null;
  const customFeedUrl = feedToken ? `${siteUrl}/api/feed/custom?token=${feedToken}` : null;

  if (status === 'loading' || isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
          My Subscriptions
        </h1>

        {/* How to Add to Calendar Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            How to Add Your Calendar Feed
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            To add your calendar feed to your calendar app, copy the feed URL below and follow the instructions for your calendar provider.
          </p>
          <CalendarInstructions />
        </div>

        {/* Google Calendar Integration Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Google Calendar Integration
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Connect your Google Calendar to automatically sync your subscribed events. Changes to events will be updated in your calendar.
          </p>

          {gcalConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Google Calendar Connected</span>
              </div>

              {syncResult && (
                <div
                  className={`p-4 rounded-lg ${
                    syncResult.success
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                  }`}
                >
                  <p
                    className={`text-sm ${
                      syncResult.success
                        ? 'text-green-800 dark:text-green-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}
                  >
                    {syncResult.message}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                {fullFeedUrl && (
                  <a
                    href={buildGoogleCalendarSubscribeUrl(fullFeedUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold"
                  >
                    📆 Subscribe in Google Calendar
                  </a>
                )}
                <button
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleConnectGoogleCalendar}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
            >
              Connect Google Calendar
            </button>
          )}
        </div>

        {/* Full Subscription Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Full Media Calendar Subscription
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {fullSubscription?.active
                  ? 'You are subscribed to the full calendar. All published events will appear in your feed.'
                  : 'Subscribe to receive all published events in your calendar feed.'}
              </p>
            </div>
            <button
              onClick={handleToggleFullSubscription}
              disabled={isToggling}
              className={`px-6 py-2 rounded-lg font-semibold transition ${
                fullSubscription?.active
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isToggling
                ? '...'
                : fullSubscription?.active
                ? 'Deactivate'
                : 'Activate'}
            </button>
          </div>

          {fullSubscription?.active && fullFeedUrl && (
            <div className="mt-4 space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Full Calendar Feed URL:
                </h3>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={fullFeedUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-white"
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
                <a
                  href={buildGoogleCalendarSubscribeUrl(fullFeedUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold text-sm"
                >
                  📆 Subscribe in Google Calendar
                </a>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  Add to Your Calendar App:
                </h3>
                <CalendarInstructions feedUrl={fullFeedUrl || undefined} />
              </div>
            </div>
          )}
        </div>

        {/* Custom Subscriptions Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            My Followed Events ({eventFollows.length})
          </h2>

          {customFeedUrl && (
            <div className="mb-4 space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Custom Calendar Feed URL:
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customFeedUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-white"
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
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  Add to Your Calendar App:
                </h3>
                <CalendarInstructions feedUrl={customFeedUrl || undefined} />
              </div>
            </div>
          )}

          {eventFollows.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-center py-8">
              You haven't followed any events yet. Browse the calendar and click "Add to My Media Calendar" on events you want to follow.
            </p>
          ) : (
            <div className="space-y-3">
              {eventFollows.map((eventFollow) => (
                <div
                  key={eventFollow.id}
                  className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {eventFollow.event.title}
                    </h3>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      <span>
                        {format(new Date(eventFollow.event.start), 'PP')}
                      </span>
                      {eventFollow.event.location && (
                        <span className="ml-2">• {eventFollow.event.location}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnfollow(eventFollow.eventId)}
                    disabled={unfollowingId === eventFollow.eventId}
                    className="ml-4 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                  >
                    {unfollowingId === eventFollow.eventId ? 'Removing...' : 'Unfollow'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Calendar
          </Link>
        </div>
      </div>
    </div>
  );
}

