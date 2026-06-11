'use client';

import { useSession, signIn } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import type { ItinerarySummary } from '@/lib/itineraryConstants';
import { ITINERARY_ITEM_KIND } from '@/lib/itineraryConstants';

type AddKind =
  | { kind: typeof ITINERARY_ITEM_KIND.EVENT; eventId: string; label?: string }
  | { kind: typeof ITINERARY_ITEM_KIND.HOST; hubHostId: string; label?: string }
  | { kind: typeof ITINERARY_ITEM_KIND.HUB; hubId: string; label?: string };

interface AddToItineraryButtonProps {
  payload: AddKind;
  hubSlug?: string;
  compact?: boolean;
  className?: string;
}

export default function AddToItineraryButton({
  payload,
  hubSlug,
  compact = false,
  className = '',
}: AddToItineraryButtonProps) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [itineraries, setItineraries] = useState<ItinerarySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmAdd, setConfirmAdd] = useState<string | null>(null);

  const loadItineraries = useCallback(async () => {
    const res = await fetch('/api/itineraries');
    if (res.ok) {
      const data = await res.json();
      setItineraries(data.itineraries ?? []);
    }
  }, []);

  useEffect(() => {
    if (open && status === 'authenticated') {
      loadItineraries();
    }
  }, [open, status, loadItineraries]);

  const handleAdd = async (itineraryId: string, confirmLargeAdd = false) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const body =
        payload.kind === ITINERARY_ITEM_KIND.EVENT
          ? { kind: payload.kind, eventId: payload.eventId, confirmLargeAdd }
          : payload.kind === ITINERARY_ITEM_KIND.HOST
            ? { kind: payload.kind, hubHostId: payload.hubHostId, confirmLargeAdd }
            : { kind: payload.kind, hubId: payload.hubId, confirmLargeAdd };

      const res = await fetch(`/api/itineraries/${itineraryId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.status === 400 && data.error === 'CONFIRM_REQUIRED') {
        setConfirmAdd(itineraryId);
        setError(
          `This adds ${data.preview?.newEventCount ?? 'many'} events. Tap again to confirm.`
        );
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to add');
      }

      setSuccess('Added to itinerary');
      setConfirmAdd(null);
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/itineraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), hubSlug }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to create');
      }
      await handleAdd(data.itinerary.id);
      setNewName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const buttonClass = compact
    ? 'inline-flex items-center justify-center px-3 py-2 rounded-lg border-2 border-white/25 text-white text-sm font-semibold hover:bg-white/10 min-h-[44px]'
    : 'inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-tmc-navy text-white text-sm font-semibold hover:opacity-90 min-h-[44px]';

  if (status !== 'authenticated') {
    return (
      <button
        type="button"
        onClick={() => signIn(undefined, { callbackUrl: window.location.href })}
        className={`${buttonClass} ${className}`}
      >
        Add to itinerary
      </button>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
      >
        Add to itinerary
      </button>
      {success && !open && (
        <span className="text-xs text-green-600 ml-2">{success}</span>
      )}
      {open && (
        <div className="absolute z-20 mt-2 right-0 w-72 rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-tmc-border p-3 text-gray-900 dark:text-gray-100">
          <p className="text-sm font-semibold mb-2">Choose itinerary</p>
          {itineraries.length === 0 && (
            <p className="text-xs text-tmc-muted mb-2">No itineraries yet.</p>
          )}
          <ul className="space-y-1 max-h-48 overflow-y-auto mb-3">
            {itineraries.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    handleAdd(it.id, confirmAdd === it.id)
                  }
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-sm min-h-[44px]"
                >
                  {it.name}
                  <span className="text-tmc-muted ml-1">({it.eventCount})</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t pt-2 space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New itinerary name"
              className="w-full px-3 py-2 rounded-lg border text-sm dark:bg-gray-800"
            />
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={handleCreate}
              className="w-full py-2 rounded-lg bg-tmc-navy text-white text-sm font-semibold disabled:opacity-50 min-h-[44px]"
            >
              {creating ? 'Creating…' : 'Create & add'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
