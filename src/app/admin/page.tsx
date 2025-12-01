'use client';

import { useEffect, useState } from 'react';
import { Event } from '@prisma/client';
import { format } from 'date-fns';

interface MonitoredUrl {
  id: string;
  url: string;
  name: string | null;
  enabled: boolean;
  lastChecked: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export default function AdminPage() {
  const [pendingEvents, setPendingEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // URL scraping state
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeName, setScrapeName] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [enableMonitoring, setEnableMonitoring] = useState(false);
  const [monitoredUrls, setMonitoredUrls] = useState<MonitoredUrl[]>([]);
  const [extractedEvents, setExtractedEvents] = useState<any[]>([]);
  const [extractionMethod, setExtractionMethod] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingEvents();
    fetchMonitoredUrls();
  }, []);

  const setFeedback = (type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      setSuccessMessage(message);
      setError(null);
    } else {
      setError(message);
      setSuccessMessage(null);
    }
    setTimeout(() => {
      setSuccessMessage(null);
      setError(null);
    }, 5000);
  };

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
      setFeedback('success', 'Event approved and published!');
    } catch (err: any) {
      setFeedback('error', err.message);
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
      setFeedback('success', 'Event rejected and deleted.');
    } catch (err: any) {
      setFeedback('error', err.message);
    }
  };

  const fetchMonitoredUrls = async () => {
    try {
      const res = await fetch('/api/scrape?action=monitored');
      if (!res.ok) throw new Error('Failed to fetch monitored URLs');
      const data = await res.json();
      setMonitoredUrls(data.urls || []);
    } catch (err: any) {
      console.error('Failed to fetch monitored URLs:', err);
    }
  };

  const handleScrapeUrl = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scrapeUrl.trim()) return;

    setScraping(true);
    setScrapeResult(null);
    setError(null);
    setSuccessMessage(null);
    setExtractedEvents([]);
    setExtractionMethod(null);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: scrapeUrl,
          name: scrapeName || undefined,
          enableMonitoring,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scrape URL');

      const resultParts = [
        `✅ Scraped successfully using ${data.extractionMethod || 'agent'} method`,
        `Found ${data.eventsFound || 0} events`,
        data.eventsAdded ? `Added ${data.eventsAdded} new events (pending approval)` : '',
        data.eventsSkipped ? `${data.eventsSkipped} duplicates skipped` : '',
        data.skippedPastEvents ? `${data.skippedPastEvents} past events skipped` : '',
        enableMonitoring && data.monitoredUrl ? '✅ URL added to monitoring' : '',
      ].filter(Boolean);

      setScrapeResult(resultParts.join('\n'));
      setExtractedEvents(data.extractedEvents || []);
      setExtractionMethod(data.extractionMethod || null);
      if (enableMonitoring) await fetchMonitoredUrls();
      setScrapeUrl('');
      setScrapeName('');
      setEnableMonitoring(false);
      setFeedback('success', 'URL scraped successfully!');
      await fetchPendingEvents(); // Refresh pending events list
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to scrape URL');
      setExtractedEvents([]);
      setExtractionMethod(null);
    } finally {
      setScraping(false);
    }
  };

  const handleToggleMonitoring = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/scrape', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: !enabled }),
      });

      if (!res.ok) throw new Error('Failed to update monitored URL');
      await fetchMonitoredUrls();
      setFeedback('success', 'Monitoring preference updated.');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to update monitored URL');
    }
  };

  const handleDeleteMonitoredUrl = async (id: string) => {
    if (!confirm('Remove this monitored URL?')) return;

    try {
      const res = await fetch(`/api/scrape?id=${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete monitored URL');
      await fetchMonitoredUrls();
      setFeedback('success', 'Monitored URL removed.');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to delete monitored URL');
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
          Admin Dashboard
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Manage events, scrape URLs, and monitor sources
        </p>
        <p className="text-sm text-yellow-600 dark:text-yellow-500 mt-2">
          ⚠️ Note: This page has no authentication yet. Implement auth before production use.
        </p>
      </div>

      {(error || successMessage || scrapeResult) && (
        <div className="mb-6 space-y-2">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              Error: {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
              {successMessage}
            </div>
          )}
          {scrapeResult && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg whitespace-pre-line">
              {scrapeResult}
            </div>
          )}
        </div>
      )}

      {/* URL Scraping Section */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
          🔍 Scrape Events from URL
        </h2>
        <form onSubmit={handleScrapeUrl} className="space-y-4">
          <div>
            <label htmlFor="scrape-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              URL to Scrape
            </label>
            <input
              type="url"
              id="scrape-url"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              placeholder="https://example.com/events"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              required
            />
          </div>
          <div>
            <label htmlFor="scrape-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Source Name (optional)
            </label>
            <input
              type="text"
              id="scrape-name"
              value={scrapeName}
              onChange={(e) => setScrapeName(e.target.value)}
              placeholder="e.g., MediaPost Events"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="enable-monitoring"
              checked={enableMonitoring}
              onChange={(e) => setEnableMonitoring(e.target.checked)}
              className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="enable-monitoring" className="text-sm text-gray-700 dark:text-gray-300">
              Enable automatic monitoring (checks this URL daily for updates)
            </label>
          </div>
          <button
            type="submit"
            disabled={scraping}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scraping ? 'Scraping…' : 'Scrape URL'}
          </button>
        </form>
      </div>

      {/* Extracted Events Preview Section */}
      {extractedEvents.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              📋 Extracted Events Preview ({extractedEvents.length})
            </h2>
            {extractionMethod && (
              <span className="text-sm px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
                Method: {extractionMethod}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {extractedEvents.map((event, index) => (
              <div
                key={index}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {event.title}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600 dark:text-gray-400">
                      {event.start && (
                        <div>
                          <strong>Start:</strong>{' '}
                          {format(new Date(event.start), 'PPpp')}
                          {event.date_status && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                              event.date_status === 'confirmed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}>
                              {event.date_status}
                            </span>
                          )}
                        </div>
                      )}
                      {event.end && (
                        <div>
                          <strong>End:</strong> {format(new Date(event.end), 'PPpp')}
                        </div>
                      )}
                      {event.location && (
                        <div>
                          <strong>Location:</strong> {event.location}
                          {event.location_status && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                              event.location_status === 'confirmed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}>
                              {event.location_status}
                            </span>
                          )}
                        </div>
                      )}
                      {event.source && (
                        <div>
                          <strong>Source:</strong> {event.source}
                        </div>
                      )}
                      {event.url && (
                        <div className="md:col-span-2">
                          <strong>Link:</strong>{' '}
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline break-all"
                          >
                            {event.url}
                          </a>
                        </div>
                      )}
                      {event.evidence && (
                        <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-500">
                          <strong>Date Evidence:</strong> {event.evidence}
                        </div>
                      )}
                      {event.location_evidence && (
                        <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-500">
                          <strong>Location Evidence:</strong> {event.location_evidence}
                        </div>
                      )}
                    </div>
                    {event.description && (
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        <strong>Description:</strong>
                        <p className="mt-1 whitespace-pre-wrap">{event.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ℹ️ These events have been automatically saved as pending and are available for approval below.
            </p>
          </div>
        </div>
      )}

      {/* Monitored URLs Section */}
      {monitoredUrls.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">📡 Monitored URLs</h2>
          <div className="space-y-4">
            {monitoredUrls.map((url) => (
              <div
                key={url.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {url.name || url.url}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 break-all">{url.url}</p>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-500 space-y-1">
                      {url.lastChecked && (
                        <p>Last checked: {format(new Date(url.lastChecked), 'PPpp')}</p>
                      )}
                      {url.lastSuccess && (
                        <p className="text-green-600">Last success: {format(new Date(url.lastSuccess), 'PPpp')}</p>
                      )}
                      {url.lastError && (
                        <p className="text-red-600">Last error: {url.lastError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleToggleMonitoring(url.id, url.enabled)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                        url.enabled
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400 dark:bg-gray-600 dark:text-white'
                      }`}
                    >
                      {url.enabled ? '✓ Enabled' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => handleDeleteMonitoredUrl(url.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Events Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
          ⏳ Pending Events ({pendingEvents.length})
        </h2>
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
    </div>
  );
}
