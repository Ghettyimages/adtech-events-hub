'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { buildGoogleCalendarSubscribeUrl } from '@/lib/events';

interface HomePageActionsProps {
  siteUrl: string;
}

export default function HomePageActions({ siteUrl }: HomePageActionsProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const feedUrl = `${siteUrl}/api/feed`;
  const subscribeUrl = buildGoogleCalendarSubscribeUrl(feedUrl);

  if (status === 'authenticated' && session) {
    return (
      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
        <a
          href={subscribeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-6 py-3 bg-tmc-navy text-white rounded-lg hover:bg-tmc-blue transition font-semibold"
        >
          📆 Subscribe in Google Calendar
        </a>
        <a
          href="/api/feed"
          download="adtech-events.ics"
          className="inline-flex items-center px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition font-semibold"
        >
          ⬇️ Download iCal Feed
        </a>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex flex-col gap-4 justify-center items-center">
        <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-4 max-w-2xl">
          <p className="text-sm text-tmc-navy dark:text-cyan-200 text-center mb-4">
            <strong>Login to subscribe to The Media Calendar, add events to your calendar and customize your event feeds.</strong>
          </p>
          <div className="flex justify-center">
            <button
              onClick={() => router.push('/login')}
              className="inline-flex items-center px-6 py-3 bg-tmc-navy text-white rounded-lg hover:bg-tmc-blue transition font-semibold"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
      <div className="inline-flex items-center px-6 py-3 bg-gray-300 text-gray-600 rounded-lg font-semibold">
        Loading...
      </div>
    </div>
  );
}

