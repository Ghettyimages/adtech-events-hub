import { Suspense } from 'react';
import Calendar from '@/components/Calendar';
import HomePageActions from '@/components/HomePageActions';

function CalendarFallback() {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="text-xl text-gray-600">Loading calendar...</div>
    </div>
  );
}

export default function HomePage() {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          The Media Calendar
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
          Discover upcoming conferences, webinars, and networking events in the AdTech ecosystem.
        </p>
        <HomePageActions siteUrl={siteUrl} />
      </div>

      <Suspense fallback={<CalendarFallback />}>
        <Calendar />
      </Suspense>
    </div>
  );
}
