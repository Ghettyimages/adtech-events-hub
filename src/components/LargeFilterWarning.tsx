'use client';

import Link from 'next/link';

interface LargeFilterWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscribeAnyway: () => void;
  matchCount: number;
  totalCount: number;
  percentage: number;
  filterDescription: string;
}

export default function LargeFilterWarning({
  isOpen,
  onClose,
  onSubscribeAnyway,
  matchCount,
  totalCount,
  percentage,
  filterDescription,
}: LargeFilterWarningProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">⚠️</span>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
            Large Filter Match
          </h3>
        </div>

        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-lg font-semibold text-yellow-800 dark:text-yellow-200">
            This filter matches {matchCount} events ({percentage}% of all {totalCount} events)
          </p>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          <strong>Filter:</strong> {filterDescription}
        </p>

        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>💡 Tip:</strong> Filters are most valuable for targeted selections like "Programmatic events in New York" (typically 10-30 events), not broad filters like "All US events" (200+ events).
          </p>
          <p className="text-sm text-blue-800 dark:text-blue-200 mt-2">
            Consider narrowing your filter criteria or subscribing to the <strong>Full Calendar</strong> to get all events.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/subscriptions"
            className="w-full px-4 py-3 bg-blue-600 text-white text-center rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            📅 Set Up Full Calendar Subscription
          </Link>
          
          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition font-semibold"
          >
            🔍 Narrow My Filter
          </button>
          
          <button
            onClick={onSubscribeAnyway}
            className="w-full px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition text-sm"
          >
            Subscribe to this filter anyway
          </button>
        </div>
      </div>
    </div>
  );
}
