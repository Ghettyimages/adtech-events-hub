'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import type {
  ItineraryEventRow,
  ItineraryItemRow,
  ItinerarySummary,
} from '@/lib/itineraryConstants';
import ItineraryDayTimeline from './ItineraryDayTimeline';
import { Event } from '@prisma/client';
import EventCard from '@/components/EventCard';

interface ItineraryDetailClientProps {
  slug: string;
}

export default function ItineraryDetailClient({ slug }: ItineraryDetailClientProps) {
  const { status } = useSession();
  const [itinerary, setItinerary] = useState<ItinerarySummary | null>(null);
  const [items, setItems] = useState<ItineraryItemRow[]>([]);
  const [events, setEvents] = useState<ItineraryEventRow[]>([]);
  const [displayTimezone, setDisplayTimezone] = useState('Europe/Paris');
  const [stats, setStats] = useState({ total: 0, timed: 0, allDay: 0 });
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`/api/itineraries/${slug}`),
        fetch(`/api/itineraries/${slug}/events`),
      ]);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        setItinerary(detail.itinerary);
        setItems(detail.items ?? []);
      }
      if (eventsRes.ok) {
        const ev = await eventsRes.json();
        setEvents(ev.events ?? []);
        setDisplayTimezone(ev.displayTimezone ?? 'Europe/Paris');
        setStats(ev.stats ?? { total: 0, timed: 0, allDay: 0 });
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (status === 'authenticated') {
      load();
    } else if (status === 'unauthenticated') {
      setLoading(false);
    }
  }, [status, load]);

  const handleSubscribe = async () => {
    if (!itinerary) return;
    setSubscribing(true);
    setMessage('');
    try {
      const res = await fetch(`/api/itineraries/${itinerary.id}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptTerms: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error);
      }
      setMessage(data.message || 'Subscribed');
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Subscribe failed');
    } finally {
      setSubscribing(false);
    }
  };

  const handleSync = async () => {
    if (!itinerary) return;
    setSyncing(true);
    setMessage('');
    try {
      const res = await fetch('/api/mine/gcal/itinerary/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itineraryId: itinerary.id }),
      });
      const data = await res.json();
      setMessage(data.message || (res.ok ? 'Synced' : data.error));
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!itinerary) return;
    await fetch(`/api/itineraries/${itinerary.id}/items/${itemId}`, {
      method: 'DELETE',
    });
    await load();
  };

  if (status === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="mb-4">Sign in to view your itinerary.</p>
        <button
          type="button"
          onClick={() => signIn(undefined, { callbackUrl: `/itinerary/${slug}` })}
          className="px-6 py-3 rounded-lg bg-tmc-navy text-white font-semibold min-h-[44px]"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (loading) {
    return <p className="container mx-auto px-4 py-12 text-tmc-muted">Loading…</p>;
  }

  if (!itinerary) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p>Itinerary not found.</p>
        <Link href="/itinerary" className="text-tmc-navy underline mt-2 inline-block">
          Back to itineraries
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/itinerary" className="text-sm text-tmc-muted hover:underline">
        ← My itineraries
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-tmc-navy">{itinerary.name}</h1>
        {itinerary.hubName && (
          <p className="text-tmc-muted mt-1">
            Linked to{' '}
            <Link href={`/hubs/${itinerary.hubSlug}`} className="underline">
              {itinerary.hubName}
            </Link>
          </p>
        )}
        <p className="text-sm text-tmc-muted mt-2">
          {stats.total} events ({stats.timed} syncable timed
          {stats.allDay > 0 ? `, ${stats.allDay} date-only` : ''})
        </p>

        <div className="flex flex-wrap gap-2 mt-4">
          {!itinerary.gcalSyncEnabled ? (
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={subscribing || stats.timed === 0}
              className="px-4 py-2.5 rounded-lg bg-tmc-navy text-white font-semibold min-h-[44px] disabled:opacity-50"
            >
              {subscribing ? 'Subscribing…' : 'Subscribe to Google Calendar'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2.5 rounded-lg border-2 border-tmc-navy text-tmc-navy font-semibold min-h-[44px]"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {itinerary.gcalSyncEnabled && (
            <span className="text-sm text-green-700 self-center">GCal connected</span>
          )}
          {itinerary.gcalSyncPending && (
            <span className="text-sm text-amber-700 self-center">Sync pending…</span>
          )}
        </div>
        {message && <p className="text-sm mt-2 text-tmc-muted">{message}</p>}
        {itinerary.gcalLastSyncError && (
          <p className="text-sm mt-1 text-red-600">{itinerary.gcalLastSyncError}</p>
        )}
      </header>

      {items.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-tmc-navy mb-3">Sources</h2>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
              >
                <span className="text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-tmc-muted ml-2 text-xs uppercase">{item.kind}</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="text-xs text-red-600 hover:underline min-h-[44px] px-2"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ItineraryDayTimeline
        events={events}
        displayTimezone={displayTimezone}
        onSelectEvent={(ev) => setSelectedEvent(ev as unknown as Event)}
      />

      {selectedEvent && (
        <EventCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
