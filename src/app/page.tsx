import Calendar from '@/components/Calendar';
import { buildGoogleCalendarSubscribeUrl } from '@/lib/events';

export default function HomePage() {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const feedUrl = `${siteUrl}/api/feed`;
  const subscribeUrl = buildGoogleCalendarSubscribeUrl(feedUrl);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          AdTech & Media Events Calendar
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
          Discover upcoming conferences, webinars, and networking events in the AdTech ecosystem.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <a
            href={subscribeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold"
          >
            📆 Subscribe in Google Calendar
          </a>
          <a
            href="/api/feed"
            download="adtech-events.ics"
            className="inline-flex items-center px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-semibold"
          >
            ⬇️ Download iCal Feed
          </a>
        </div>
      </div>

      <Calendar />
    </div>
  );
}
