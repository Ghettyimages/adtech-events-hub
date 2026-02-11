'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import CalendarInstructions from '@/components/CalendarInstructions';
import { buildGoogleCalendarSubscribeUrl } from '@/lib/events';

interface Subscription {
  id: string;
  kind: string;
  active: boolean;
  filter?: string | null;
  createdAt: string;
}

interface FilterSubscription extends Subscription {
  filter: string;
  filterDescription?: string;
  matchCount?: number;
}

interface EventFollow {
  id: string;
  eventId: string;
  source: string;
  subscriptionId?: string | null;
  createdAt: string;
  event: {
    id: string;
    title: string;
    start: string;
    end: string;
    location: string | null;
  };
}

function SubscriptionsPageFallback() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">My Subscriptions</h1>
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

function SubscriptionsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isJustConnectedGcal = searchParams.get('gcal') === 'connected';
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [eventFollows, setEventFollows] = useState<EventFollow[]>([]);
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalSyncEnabled, setGcalSyncEnabled] = useState(false);
  const [gcalSyncStatus, setGcalSyncStatus] = useState<{
    enabled: boolean;
    pending: boolean;
    mode: string;
    calendarId: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    lastSyncAttemptAt: string | null;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Filter subscriptions state
  const [filterSubscriptions, setFilterSubscriptions] = useState<FilterSubscription[]>([]);
  const [deletingFilterId, setDeletingFilterId] = useState<string | null>(null);
  
  // Modal state for unfollow exclusion choice
  const [unfollowModal, setUnfollowModal] = useState<{
    isOpen: boolean;
    eventId: string;
    eventTitle: string;
    subscriptionId?: string;
  } | null>(null);
  
  // Modal state for delete filter choice
  const [deleteFilterModal, setDeleteFilterModal] = useState<{
    isOpen: boolean;
    subscriptionId: string;
    filterDescription: string;
    followCount: number;
  } | null>(null);

  useEffect(() => {
    console.log('🔍 useEffect triggered - status:', status, 'session:', !!session);
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/subscriptions');
      return;
    }

    if (status === 'authenticated' && session) {
      console.log('🔍 Fetching subscriptions and checking Google Calendar status...');
      fetchSubscriptions();
      checkGoogleCalendarStatus();
    }
  }, [status, session, router]);

  // Debug: Log state changes
  useEffect(() => {
    console.log('🔍 State changed - gcalConnected:', gcalConnected);
  }, [gcalConnected]);

  const fetchSubscriptions = async () => {
    try {
      const response = await fetch('/api/subscriptions');
      if (response.ok) {
        const data = await response.json();
        const allSubscriptions: Subscription[] = data.subscriptions || [];
        
        // Separate filter subscriptions from other subscriptions
        const filters: FilterSubscription[] = [];
        const others: Subscription[] = [];
        
        for (const sub of allSubscriptions) {
          if (sub.kind === 'CUSTOM' && sub.filter) {
            try {
              const filterObj = JSON.parse(sub.filter);
              const parts: string[] = [];
              if (filterObj.tags?.length > 0) parts.push(`Tags: ${filterObj.tags.join(', ')}`);
              if (filterObj.country) parts.push(`Country: ${filterObj.country}`);
              if (filterObj.region) parts.push(`Region: ${filterObj.region}`);
              if (filterObj.city) parts.push(`City: ${filterObj.city}`);
              if (filterObj.source) parts.push(`Source: ${filterObj.source}`);
              
              filters.push({
                ...sub,
                filter: sub.filter,
                filterDescription: parts.length > 0 ? parts.join(' • ') : 'All events',
              });
            } catch {
              others.push(sub);
            }
          } else {
            others.push(sub);
          }
        }
        
        setSubscriptions(others);
        setFilterSubscriptions(filters);
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
        console.log('🔍 Google Calendar status response:', JSON.stringify(data, null, 2));
        console.log('🔍 Setting gcalConnected to:', data.connected);
        console.log('🔍 Setting gcalSyncEnabled to:', data.sync?.enabled);
        setGcalConnected(data.connected || false);
        setGcalSyncEnabled(data.sync?.enabled || false);
        setGcalSyncStatus(data.sync || null);
        console.log('🔍 State updated - gcalConnected should be:', data.connected);
        
        // If has Google account but sync not enabled, auto-enable it
        // This handles the reconnect flow after disconnect
        if (data.hasGoogleAccount && !data.sync?.enabled) {
          try {
            await fetch('/api/mine/gcal/ensure', { method: 'POST' });
            // Refresh status after ensure
            await checkGoogleCalendarStatus();
          } catch (error) {
            console.error('Error ensuring calendar:', error);
          }
        }
      } else {
        console.error('❌ Failed to fetch Google Calendar status:', response.status);
        const errorText = await response.text();
        console.error('❌ Error response:', errorText);
      }
    } catch (error) {
      console.error('❌ Error checking Google Calendar status:', error);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    // Use NextAuth's client helper (Auth.js v5 can error on direct /api/auth/signin/google navigation)
    await signIn('google', { callbackUrl: '/subscriptions?gcal=connected', redirect: true });
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!confirm('Are you sure you want to disconnect Google Calendar? This will stop syncing events to your calendar.')) {
      return;
    }

    setIsDisconnecting(true);
    try {
      const response = await fetch('/api/mine/gcal/disconnect', {
        method: 'POST',
      });

      const data = await response.json();
      if (response.ok) {
        setGcalConnected(false);
        setGcalSyncEnabled(false);
        setGcalSyncStatus(null);
        setSyncResult({
          success: true,
          message: data.message || 'Google Calendar disconnected successfully',
        });
      } else {
        setSyncResult({
          success: false,
          message: data.error || 'Failed to disconnect Google Calendar',
        });
      }
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.message || 'An error occurred while disconnecting',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCleanupPrimaryCalendar = async () => {
    if (!confirm('This will delete all events from your primary Google Calendar that were synced by The Media Calendar. This cannot be undone. Continue?')) {
      return;
    }

    setIsCleaningUp(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/mine/gcal/cleanup-primary', {
        method: 'POST',
      });

      const data = await response.json();
      if (response.ok) {
        setSyncResult({
          success: true,
          message: data.message || 'Primary calendar cleaned up successfully',
        });
      } else {
        setSyncResult({
          success: false,
          message: data.error || 'Failed to cleanup primary calendar',
        });
      }
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.message || 'An error occurred while cleaning up',
      });
    } finally {
      setIsCleaningUp(false);
    }
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

  const handleChangeSyncMode = async (newMode: 'FULL' | 'CUSTOM') => {
    if (gcalSyncStatus?.mode === newMode) return;
    
    setIsChangingMode(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/mine/gcal/sync-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });

      const data = await response.json();
      if (response.ok) {
        setSyncResult({
          success: true,
          message: data.message || `Sync mode changed to ${newMode}`,
        });
        // Refresh connection status
        await checkGoogleCalendarStatus();
      } else {
        setSyncResult({
          success: false,
          message: data.error || 'Failed to change sync mode',
        });
      }
    } catch (error: any) {
      setSyncResult({
        success: false,
        message: error.message || 'An error occurred while changing sync mode',
      });
    } finally {
      setIsChangingMode(false);
    }
  };

  const handleFirstSyncFull = async () => {
    if (gcalSyncStatus?.mode !== 'FULL') {
      await handleChangeSyncMode('FULL');
    }
    await handleSyncNow();
  };

  const handleFirstSyncCustom = async () => {
    if (gcalSyncStatus?.mode !== 'CUSTOM') {
      await handleChangeSyncMode('CUSTOM');
    }
    await handleSyncNow();
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

  const handleUnfollow = async (eventId: string, excludeFromFilter?: boolean, confirmUnfollow?: boolean) => {
    setUnfollowingId(eventId);
    try {
      const response = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, excludeFromFilter, confirmUnfollow }),
      });

      const data = await response.json();
      
      if (data.requiresExclusionChoice) {
        // Show modal to ask about exclusion
        const eventFollow = eventFollows.find((ef) => ef.eventId === eventId);
        setUnfollowModal({
          isOpen: true,
          eventId,
          eventTitle: eventFollow?.event.title || 'this event',
          subscriptionId: data.subscriptionId,
        });
        setUnfollowingId(null);
        return;
      }

      if (response.ok) {
        setEventFollows(eventFollows.filter((ef) => ef.eventId !== eventId));
        setUnfollowModal(null);
      } else {
        alert(data.error || 'Failed to unfollow event');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setUnfollowingId(null);
    }
  };

  const handleDeleteFilterSubscription = async (subscriptionId: string, keepFollows?: boolean, confirmDelete?: boolean) => {
    setDeletingFilterId(subscriptionId);
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepFollows, confirmDelete }),
      });

      const data = await response.json();
      
      if (data.requiresCleanupChoice) {
        // Get filter description for the modal
        const filterSub = filterSubscriptions.find((f) => f.id === subscriptionId);
        setDeleteFilterModal({
          isOpen: true,
          subscriptionId,
          filterDescription: filterSub?.filterDescription || 'this filter',
          followCount: data.followCount,
        });
        setDeletingFilterId(null);
        return;
      }

      if (response.ok) {
        setFilterSubscriptions(filterSubscriptions.filter((f) => f.id !== subscriptionId));
        setDeleteFilterModal(null);
        // Refresh event follows in case some were removed
        fetchSubscriptions();
      } else {
        alert(data.error || 'Failed to delete filter subscription');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setDeletingFilterId(null);
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
    console.log('🔍 No session, returning null');
    return null;
  }

  // Debug: Log render state
  console.log('🔍 Rendering subscriptions page - gcalConnected:', gcalConnected);

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
          My Subscriptions
        </h1>

        {/* Google Calendar Integration Section - PRIMARY METHOD */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg shadow-lg p-6 mb-6 border-2 border-blue-300 dark:border-blue-700">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                clipRule="evenodd"
              />
            </svg>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Connect Google Calendar (Recommended)
            </h2>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <span>✨</span>
              <span>Best Experience - Automatic Sync</span>
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>Creates a dedicated "The Media Calendar" in your Google Calendar</li>
              <li>Events automatically sync and stay updated</li>
              <li>You can track which events you're subscribed to</li>
              <li>Works seamlessly with your existing calendar</li>
            </ul>
          </div>

          {/* Debug Info - Keep for debugging */}
          <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-400 rounded text-xs">
            <strong>DEBUG:</strong> gcalConnected={String(gcalConnected)}, 
            gcalSyncEnabled={String(gcalSyncEnabled)}, 
            hasStatus={String(!!gcalSyncStatus)}
          </div>

          {/* Test buttons that always render - Keep for debugging */}
          <div className="mb-4 p-3 bg-blue-100 dark:bg-blue-900/20 border border-blue-400 rounded">
            <p className="text-xs mb-2 font-semibold">TEST BUTTONS (Always Visible):</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  console.log('Test Disconnect clicked');
                  handleDisconnectGoogleCalendar();
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded border-2 border-red-800"
              >
                Test Disconnect
              </button>
              <button
                onClick={() => {
                  console.log('Test Cleanup clicked');
                  handleCleanupPrimaryCalendar();
                }}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded border-2 border-orange-800"
              >
                Test Cleanup
              </button>
              <button
                onClick={() => {
                  console.log('Refresh status clicked');
                  checkGoogleCalendarStatus();
                }}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded border-2 border-blue-800"
              >
                Refresh Status
              </button>
            </div>
          </div>

          {(() => {
            console.log('🔍 Render check - gcalConnected:', gcalConnected);
            console.log('🔍 Render check - buttons should render:', gcalConnected);
            return null;
          })()}
          
          {gcalConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
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
                <button
                  onClick={handleDisconnectGoogleCalendar}
                  disabled={isDisconnecting}
                  className="px-6 py-3 text-base font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50 border-2 border-red-800 shadow-lg min-w-[120px]"
                  style={{ display: 'block', visibility: 'visible' }}
                >
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>

              {/* Initial sync prompt: show when connected but no first sync yet */}
              {gcalConnected && (gcalSyncStatus?.pending === true || gcalSyncStatus?.lastSyncedAt == null) && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-lg p-5">
                  <p className="text-base font-semibold text-amber-900 dark:text-amber-200 mb-2">
                    {isJustConnectedGcal
                      ? 'Welcome back! Finish setup by running your first sync.'
                      : 'Google Calendar is connected. To start tracking events, run your first sync.'}
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-300 mb-4">
                    Choose one option below to sync events to your calendar.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleFirstSyncFull}
                      disabled={isSyncing || isChangingMode}
                      className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSyncing || isChangingMode ? 'Syncing...' : 'Sync FULL (all events)'}
                    </button>
                    <button
                      type="button"
                      onClick={handleFirstSyncCustom}
                      disabled={isSyncing || isChangingMode}
                      className="px-5 py-2.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSyncing || isChangingMode ? 'Syncing...' : 'Sync CUSTOM (subscribed only)'}
                    </button>
                  </div>
                </div>
              )}

              {/* Sync Mode Selection */}
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <span>⚙️</span>
                  <span>Sync Mode</span>
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Choose which events to sync to your Google Calendar:
                </p>
                <div className="space-y-3">
                  <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                    gcalSyncStatus?.mode === 'FULL' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  } ${isChangingMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                      type="radio"
                      name="syncMode"
                      value="FULL"
                      checked={gcalSyncStatus?.mode === 'FULL'}
                      onChange={() => handleChangeSyncMode('FULL')}
                      disabled={isChangingMode}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Full Calendar</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Sync all published events to your calendar
                      </div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                    gcalSyncStatus?.mode === 'CUSTOM' 
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  } ${isChangingMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                      type="radio"
                      name="syncMode"
                      value="CUSTOM"
                      checked={gcalSyncStatus?.mode === 'CUSTOM'}
                      onChange={() => handleChangeSyncMode('CUSTOM')}
                      disabled={isChangingMode}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        Only My Followed Events {eventFollows.length > 0 && `(${eventFollows.length})`}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Only sync events you've explicitly followed. New follows are auto-synced!
                      </div>
                    </div>
                  </label>
                </div>
                {isChangingMode && (
                  <div className="mt-3 flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-sm">Changing sync mode and syncing events...</span>
                  </div>
                )}
              </div>

              {/* Info box when Google Calendar is connected */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>💡 Tip:</strong> You're using automatic sync! Your events are already being synced to 
                  "The Media Calendar" in your Google Calendar. 
                  {gcalSyncStatus?.mode === 'CUSTOM' 
                    ? ' When you follow a new event, it will automatically appear in your calendar!'
                    : ' You don\'t need to manually subscribe to feeds.'}
                </p>
              </div>

              {gcalSyncEnabled && gcalSyncStatus && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Auto-sync:</span>
                      <span className={gcalSyncStatus.pending ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}>
                        {gcalSyncStatus.pending ? 'Pending' : 'Active'}
                      </span>
                      <span className="text-gray-400 dark:text-gray-500">•</span>
                      <span className="font-medium">Mode:</span>
                      <span className="text-blue-600 dark:text-blue-400">
                        {gcalSyncStatus.mode === 'CUSTOM' ? 'Followed Events Only' : 'Full Calendar'}
                      </span>
                    </div>
                    {gcalSyncStatus.lastSyncedAt && (
                      <div>
                        <span className="font-medium">Last synced:</span>{' '}
                        {format(new Date(gcalSyncStatus.lastSyncedAt), 'PPp')}
                      </div>
                    )}
                    {gcalSyncStatus.lastSyncError && (
                      <div className="text-red-600 dark:text-red-400">
                        <span className="font-medium">Last error:</span> {gcalSyncStatus.lastSyncError}
                      </div>
                    )}
                    {gcalSyncStatus.calendarId && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Dedicated calendar "The Media Calendar" created
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                <button
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now (Manual)'}
                </button>
              </div>

              <div className="pt-4 border-t-2 border-gray-300 dark:border-gray-600">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  If you previously synced events to your primary calendar, you can clean them up:
                </p>
                <button
                  onClick={handleCleanupPrimaryCalendar}
                  disabled={isCleaningUp}
                  className="px-8 py-4 text-base font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed border-4 border-orange-800 shadow-lg w-full sm:w-auto"
                  style={{ display: 'block', visibility: 'visible' }}
                >
                  {isCleaningUp ? 'Cleaning up...' : 'Remove Events from Primary Calendar'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleConnectGoogleCalendar}
              className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition font-bold text-lg shadow-lg"
            >
              🔗 Connect Google Calendar
            </button>
          )}
        </div>

        {/* Alternative: Manual Feed Subscription Section */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg shadow p-6 mb-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Alternative: Manual Feed Subscription
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            For users who prefer feed subscriptions or use other calendar apps (Apple Calendar, Outlook, etc.)
          </p>

          {/* How to Add to Calendar Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              How to Add Your Calendar Feed
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              To add your calendar feed to your calendar app, copy the feed URL below and follow the instructions for your calendar provider.
            </p>
            <CalendarInstructions />
          </div>

          {/* Full Subscription Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Full Media Calendar Subscription
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {fullSubscription?.active
                    ? 'You are subscribed to the full calendar. All published events will appear in your feed.'
                    : 'Subscribe to receive all published events in your calendar feed.'}
                </p>
              </div>
              <button
                onClick={handleToggleFullSubscription}
                disabled={isToggling}
                className={`px-4 py-2 rounded-lg font-semibold transition text-sm ${
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
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Full Calendar Feed URL:
                  </h4>
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
              </div>
            )}
          </div>

          {/* Filter Subscriptions Section */}
          {filterSubscriptions.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                My Filter Subscriptions ({filterSubscriptions.length})
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                These filters automatically add matching events to your calendar.
              </p>
              <div className="space-y-3">
                {filterSubscriptions.map((filterSub) => (
                  <div
                    key={filterSub.id}
                    className="flex items-center justify-between p-4 border border-purple-200 dark:border-purple-700 rounded-lg bg-purple-50 dark:bg-purple-900/20"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-600 dark:text-purple-400">🔍</span>
                        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
                          {filterSub.filterDescription}
                        </h4>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Created {format(new Date(filterSub.createdAt), 'PP')}
                        {filterSub.matchCount !== undefined && (
                          <span className="ml-2">• {filterSub.matchCount} events matched</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFilterSubscription(filterSub.id)}
                      disabled={deletingFilterId === filterSub.id}
                      className="ml-4 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                    >
                      {deletingFilterId === filterSub.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Subscriptions Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              My Followed Events ({eventFollows.length})
            </h3>

            {customFeedUrl && (
              <div className="mb-4 space-y-4">
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Custom Calendar Feed URL:
                  </h4>
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
                  <a
                    href={buildGoogleCalendarSubscribeUrl(customFeedUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-full mt-3 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold text-sm"
                  >
                    📆 Subscribe in Google Calendar
                  </a>
                </div>
              </div>
            )}

            {eventFollows.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-center py-8 text-sm">
                You haven't followed any events yet. Browse the calendar and click "Add to My Media Calendar" on events you want to follow.
              </p>
            ) : (
              <div className="space-y-3">
                {eventFollows.map((eventFollow) => (
                  <div
                    key={eventFollow.id}
                    className={`flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition ${
                      eventFollow.source === 'FILTER'
                        ? 'border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
                          {eventFollow.event.title}
                        </h4>
                        {eventFollow.source === 'FILTER' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                            Filter
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
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

      {/* Unfollow Exclusion Modal */}
      {unfollowModal?.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Unfollow Event
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              "{unfollowModal.eventTitle}" was added by a filter subscription. Would you like to exclude it permanently from this filter, or allow it to be re-added later if it still matches?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleUnfollow(unfollowModal.eventId, true)}
                disabled={unfollowingId === unfollowModal.eventId}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold disabled:opacity-50"
              >
                {unfollowingId === unfollowModal.eventId ? 'Removing...' : 'Exclude Permanently'}
              </button>
              <button
                onClick={() => handleUnfollow(unfollowModal.eventId, false, true)}
                disabled={unfollowingId === unfollowModal.eventId}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-semibold disabled:opacity-50"
              >
                {unfollowingId === unfollowModal.eventId ? 'Removing...' : 'Remove (May Re-add Later)'}
              </button>
              <button
                onClick={() => setUnfollowModal(null)}
                className="w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Filter Modal */}
      {deleteFilterModal?.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Delete Filter Subscription
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              This filter subscription has <strong>{deleteFilterModal.followCount} events</strong> that were auto-followed.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Would you like to keep these events as individual follows, or remove them along with the filter?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleDeleteFilterSubscription(deleteFilterModal.subscriptionId, true, true)}
                disabled={deletingFilterId === deleteFilterModal.subscriptionId}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50"
              >
                {deletingFilterId === deleteFilterModal.subscriptionId ? 'Deleting...' : 'Keep Events'}
              </button>
              <button
                onClick={() => handleDeleteFilterSubscription(deleteFilterModal.subscriptionId, false, true)}
                disabled={deletingFilterId === deleteFilterModal.subscriptionId}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold disabled:opacity-50"
              >
                {deletingFilterId === deleteFilterModal.subscriptionId ? 'Deleting...' : 'Remove Events'}
              </button>
              <button
                onClick={() => setDeleteFilterModal(null)}
                className="w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<SubscriptionsPageFallback />}>
      <SubscriptionsPageContent />
    </Suspense>
  );
}
