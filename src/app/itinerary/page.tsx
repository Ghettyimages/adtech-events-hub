'use client';

import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ItinerarySummary } from '@/lib/itineraryConstants';

export default function ItineraryListPage() {
  const { status } = useSession();
  const [itineraries, setItineraries] = useState<ItinerarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    fetch('/api/itineraries')
      .then((r) => r.json())
      .then((d) => setItineraries(d.itineraries ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/itineraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      setItineraries((prev) => [data.itinerary, ...prev]);
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  if (status === 'unauthenticated') {
    return (
      <div className="container mx-auto px-4 py-12 text-center max-w-lg">
        <h1 className="text-2xl font-bold text-tmc-navy mb-4">My Itineraries</h1>
        <p className="text-tmc-muted mb-6">
          Build a personal plan for Cannes or any festival — events, hosts, and hubs — with its own Google Calendar.
        </p>
        <button
          type="button"
          onClick={() => signIn(undefined, { callbackUrl: '/itinerary' })}
          className="px-6 py-3 rounded-lg bg-tmc-navy text-white font-semibold min-h-[44px]"
        >
          Sign in to get started
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-2xl md:text-3xl font-bold text-tmc-navy mb-2">My Itineraries</h1>
      <p className="text-tmc-muted mb-8">
        Curate events for the ground — separate from festival-wide hub subscriptions.
      </p>

      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2 mb-8">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Cannes 2026 Itinerary"
          className="flex-1 px-4 py-3 rounded-lg border dark:bg-gray-900 min-h-[44px]"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="px-6 py-3 rounded-lg bg-tmc-navy text-white font-semibold min-h-[44px] disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading ? (
        <p className="text-tmc-muted">Loading…</p>
      ) : itineraries.length === 0 ? (
        <p className="text-tmc-muted">
          No itineraries yet. Create one above, then add events from{' '}
          <Link href="/hubs" className="underline text-tmc-navy">
            Festival Hubs
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-3">
          {itineraries.map((it) => (
            <li key={it.id}>
              <Link
                href={`/itinerary/${it.slug}`}
                className="block p-4 rounded-xl border border-tmc-border hover:border-tmc-navy transition"
              >
                <span className="font-semibold text-tmc-navy">{it.name}</span>
                <span className="text-sm text-tmc-muted block mt-1">
                  {it.eventCount} events
                  {it.gcalSyncEnabled ? ' · Google Calendar on' : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
