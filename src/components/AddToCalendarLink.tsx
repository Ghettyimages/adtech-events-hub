'use client';

import { Event } from '@prisma/client';
import { useSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import ical, { ICalCalendar } from 'ical-generator';

interface AddToCalendarLinkProps {
  event: Event;
  isFollowing: boolean;
  fullSubscriptionActive: boolean;
  gcalConnected: boolean;
  onFollowSuccess?: () => void;
}

export default function AddToCalendarLink({
  event,
  isFollowing,
  fullSubscriptionActive,
  gcalConnected,
  onFollowSuccess,
}: AddToCalendarLinkProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const downloadICS = () => {
    const calendar: ICalCalendar = ical({ name: 'The Media Calendar' });

    const isAllDay = true;
    const endDate = new Date(event.end);
    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth();
    const endDay = endDate.getUTCDate();
    const exclusiveEndDate = new Date(
      Date.UTC(endYear, endMonth, endDay + 1, 12, 0, 0, 0)
    );

    calendar.createEvent({
      start: new Date(event.start),
      end: exclusiveEndDate,
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      url: event.url || undefined,
      allDay: isAllDay,
    });

    const icsContent = calendar.toString();
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddToCalendar = async () => {
    if (!gcalConnected) {
      setShowConnectModal(true);
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
      } else {
        setAddError(data.error || 'Failed to add to calendar');
      }
    } catch {
      setAddError('An error occurred. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleConnectFromModal = () => {
    const callbackUrl = `${window.location.origin}/subscriptions?gcal=connected&fromEvent=${event.id}`;
    signIn('google', { callbackUrl, redirect: true });
  };

  const handleSyncNow = async () => {
    setSyncError(null);
    setSyncSuccess(false);
    setIsSyncing(true);
    try {
      const res = await fetch('/api/mine/gcal/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSyncSuccess(true);
      } else {
        setSyncError(data.error || 'Sync failed');
      }
    } catch {
      setSyncError('An error occurred. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const eventInFeed = isFollowing || fullSubscriptionActive;

  // Not authenticated
  if (status === 'unauthenticated') {
    return (
      <div className="space-y-3">
        <button
          onClick={() =>
            router.push(
              `/login?callbackUrl=${encodeURIComponent(window.location.href)}`
            )
          }
          className="w-full bg-gray-600 text-white py-3 px-4 min-h-[44px] rounded-lg hover:bg-gray-700 transition font-semibold"
        >
          Sign in to Add to Calendar
        </button>
      </div>
    );
  }

  // Loading
  if (status !== 'authenticated' || !session) {
    return (
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="inline-flex items-center justify-center px-4 py-2 bg-gray-300 text-gray-600 rounded-lg font-semibold">
          Loading...
        </div>
      </div>
    );
  }

  // Already in calendar (event in feed and Google connected)
  if (eventInFeed && gcalConnected) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          <p className="font-medium text-gray-900 dark:text-white">
            This event should already be in your calendar.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Don&apos;t see it? Check your subscriptions and run a manual sync.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link
              href="/subscriptions"
              className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold text-sm"
            >
              Check My Subscriptions
            </Link>
            <button
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center justify-center px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          {syncSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-2">
              Calendar synced. Check your calendar app.
            </p>
          )}
          {syncError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">
              {syncError}
            </p>
          )}
        </div>
        <button
          onClick={downloadICS}
          className="inline-flex items-center justify-center px-4 py-3 min-h-[44px] w-full bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          Download .ics
        </button>
      </div>
    );
  }

  // In feed but not synced (event in feed, Google not connected)
  if (eventInFeed && !gcalConnected) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          <p className="font-medium text-gray-900 dark:text-white">
            This event is in your feed. Connect Google Calendar to sync it to
            your calendar.
          </p>
          <button
            onClick={handleConnectFromModal}
            className="mt-3 w-full inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Connect Google Calendar
          </button>
        </div>
        <button
          onClick={downloadICS}
          className="inline-flex items-center justify-center px-4 py-3 min-h-[44px] w-full bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          Download .ics
        </button>
      </div>
    );
  }

  // Add to Google Calendar (not in feed)
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleAddToCalendar}
          disabled={isAdding}
          className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {isAdding ? 'Adding...' : 'Add to Google Calendar'}
        </button>
        <button
          onClick={downloadICS}
          className="inline-flex items-center justify-center px-4 py-3 min-h-[44px] w-full sm:w-auto bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          Download .ics
        </button>
      </div>
      {addSuccess && (
        <p className="text-sm text-green-600 dark:text-green-400">
          Event added to your calendar.
        </p>
      )}
      {addError && (
        <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>
      )}

      {/* Connect modal when user clicks Add but not connected */}
      {showConnectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              Connect Google Calendar
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Connect Google Calendar to add events to your calendar.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleConnectFromModal}
                className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                Connect
              </button>
              <button
                onClick={() => setShowConnectModal(false)}
                className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition font-semibold"
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
