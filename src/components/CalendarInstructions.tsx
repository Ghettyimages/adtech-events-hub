'use client';

import { useState } from 'react';

interface CalendarInstructionsProps {
  feedUrl?: string;
}

export default function CalendarInstructions({ feedUrl }: CalendarInstructionsProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="space-y-3">
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">
              Important: Manual Calendar Addition Required
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Subscribing creates your calendar feed URL, but you need to manually add it to your calendar app. Follow the instructions below for your calendar provider.
            </p>
          </div>
        </div>
      </div>

      {/* Google Calendar Instructions */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('google')}
          className="w-full px-4 py-3 flex items-center justify-between bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="font-semibold text-gray-900 dark:text-white">Google Calendar</span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
              expandedSection === 'google' ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSection === 'google' && (
          <div className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
            <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  1
                </span>
                <span className="pt-0.5">Open Google Calendar</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  2
                </span>
                <span className="pt-0.5">Click the "+" next to "Other calendars"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  3
                </span>
                <span className="pt-0.5">Select "From URL"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  4
                </span>
                <span className="pt-0.5">Paste your calendar feed URL <span className="font-semibold">(From My Subscriptions Page)</span></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  5
                </span>
                <span className="pt-0.5">Click "Add calendar"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  6
                </span>
                <span className="pt-0.5">Your events will appear and auto-update</span>
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Apple Calendar / iCal Instructions */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('apple')}
          className="w-full px-4 py-3 flex items-center justify-between bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.96-3.24-1.44-1.88-.78-2.93-1.22-3.18-1.33-.6-.25-.83-.5-.83-1.05 0-.3.1-.6.3-.9.2-.3.5-.5.9-.5.3 0 .6.1.9.3.2.1.5.3.9.5.4.2.8.4 1.2.5.4.1.8.2 1.2.2.4 0 .8-.1 1.2-.2.4-.1.8-.3 1.2-.5.4-.2.7-.4.9-.5.3-.2.6-.3.9-.3.4 0 .7.2.9.5.2.3.3.6.3.9 0 .55-.23.8-.83 1.05-.25.11-1.3.55-3.18 1.33-1.16.48-2.15.94-3.24 1.44-1.03.48-2.1.55-3.08-.4zM12.03.67c-1.5 0-2.7 1.2-2.7 2.7s1.2 2.7 2.7 2.7 2.7-1.2 2.7-2.7-1.2-2.7-2.7-2.7z"/>
            </svg>
            <span className="font-semibold text-gray-900 dark:text-white">Apple Calendar / iCal</span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
              expandedSection === 'apple' ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSection === 'apple' && (
          <div className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
            <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  1
                </span>
                <span className="pt-0.5">Open Calendar app (macOS/iOS)</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  2
                </span>
                <span className="pt-0.5">Go to File → New Calendar Subscription (or Calendar → Subscribe)</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  3
                </span>
                <span className="pt-0.5">Paste your calendar feed URL <span className="font-semibold">(From My Subscriptions Page)</span></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  4
                </span>
                <span className="pt-0.5">Click "Subscribe"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  5
                </span>
                <span className="pt-0.5">Configure refresh settings and click "OK"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  6
                </span>
                <span className="pt-0.5">Your events will appear and auto-update</span>
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Outlook Instructions */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('outlook')}
          className="w-full px-4 py-3 flex items-center justify-between bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.5 21H2V9h5.5v12zm7.25-18h-7.5C5.57 3 4.5 4.57 4.5 6.375v11.25c0 1.807 1.07 3.375 2.75 3.375h7.5c1.68 0 2.75-1.568 2.75-3.375V6.375C17.5 4.57 16.43 3 14.75 3zM22 10.5v8.25c0 1.807-1.07 3.375-2.75 3.375H16v-5.25h-1.5V21H9V9h5.5v2.25H16V3h5.25C22.93 3 24 4.57 24 6.375V10.5H22z"/>
            </svg>
            <span className="font-semibold text-gray-900 dark:text-white">Outlook</span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
              expandedSection === 'outlook' ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {expandedSection === 'outlook' && (
          <div className="px-4 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
            <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  1
                </span>
                <span className="pt-0.5">Open Outlook Calendar</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  2
                </span>
                <span className="pt-0.5">Right-click "Other Calendars" → Add Calendar → From Internet</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  3
                </span>
                <span className="pt-0.5">Paste your calendar feed URL <span className="font-semibold">(From My Subscriptions Page)</span></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  4
                </span>
                <span className="pt-0.5">Click "OK"</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center font-semibold text-xs">
                  5
                </span>
                <span className="pt-0.5">Your events will appear and auto-update</span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

