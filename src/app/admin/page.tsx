'use client';

import { useEffect, useState } from 'react';
import { Event } from '@prisma/client';
import { format } from 'date-fns';

export default function AdminPage() {
  const [pendingEvents, setPendingEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingEvents();
  }, []);

  const fetchPendingEvents = async () => {
    try {
      const res = await fetch('/api/events?status=PENDING');
      if (!res.ok) throw new Error('Failed to fetch pending events');
      const data = await res.json();
      setPendingEvents(data.events);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PUBLISHED' }),
      });

      if (!res.ok) throw new Error('Failed to approve event');

      // Remove from pending list
      setPendingEvents((prev) => prev.filter((e) => e.id !== id));

      // Trigger revalidation
      await fetch('/api/revalidate', { method: 'POST' });
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Are you sure you want to reject this event?')) return;

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to reject event');

      setPendingEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          Admin - Pending Events
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Review and approve submitted events
        </p>
        <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-2">
          ⚠️ Note: This page has no authentication yet. Implement auth before production use.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
          Error: {error}
        </div>
      )}

      {pendingEvents.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            No pending events to review.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingEvents.map((event) => (
            <div
              key={event.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-md"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    {event.title}
                  </h2>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <p>
                      <strong>Start:</strong> {format(new Date(event.start), 'PPpp')}
                    </p>
                    <p>
                      <strong>End:</strong> {format(new Date(event.end), 'PPpp')}
                    </p>
                    {event.location && (
                      <p>
                        <strong>Location:</strong> {event.location}
                      </p>
                    )}
                    {event.timezone && (
                      <p>
                        <strong>Timezone:</strong> {event.timezone}
                      </p>
                    )}
                    {event.source && (
                      <p>
                        <strong>Source:</strong> {event.source}
                      </p>
                    )}
                    {event.url && (
                      <p>
                        <strong>URL:</strong>{' '}
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {event.url}
                        </a>
                      </p>
                    )}
                  </div>
                  {event.description && (
                    <div className="mt-4">
                      <strong className="text-sm text-gray-700 dark:text-gray-300">
                        Description:
                      </strong>
                      <p className="text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                        {event.description}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={() => handleApprove(event.id)}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
                >
                  ✅ Approve
                </button>
                <button
                  onClick={() => handleReject(event.id)}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
                >
                  ❌ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
