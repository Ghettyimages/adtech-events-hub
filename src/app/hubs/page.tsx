import Link from 'next/link';
import { format } from 'date-fns';
import { listHubs, parseHubTheme } from '@/lib/hubs';

export const metadata = {
  title: 'Festival Hubs | The Media Calendar',
  description: 'Explore side events at major industry festivals',
};

type Hub = Awaited<ReturnType<typeof listHubs>>[number];

function HubCard({ hub, isLive = false }: { hub: Hub; isLive?: boolean }) {
  const theme = parseHubTheme(hub.theme);

  return (
    <Link
      href={`/hubs/${hub.slug}`}
      className="block rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition bg-white dark:bg-gray-800"
    >
      <div
        className="h-24"
        style={{
          background:
            theme.heroGradient ||
            'linear-gradient(90deg, #0B2A66 0%, #145AC6 50%, #C9A227 100%)',
        }}
      />
      <div className="p-5">
        {isLive ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
            <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" aria-hidden="true" />
            Live
          </span>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {hub.status === 'ARCHIVED' ? 'Past' : 'Upcoming'}
          </span>
        )}
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-2">{hub.name}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {format(new Date(hub.start), 'MMM d')} – {format(new Date(hub.end), 'MMM d, yyyy')}
          {hub.location && ` · ${hub.location}`}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
          {hub._count.events} events · {hub._count.hosts} hosts
        </p>
        <span className="inline-block mt-3 text-tmc-blue font-medium text-sm">Enter hub →</span>
      </div>
    </Link>
  );
}

function HubSection({
  title,
  description,
  hubs,
  live = false,
}: {
  title: string;
  description: string;
  hubs: Hub[];
  live?: boolean;
}) {
  if (hubs.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {hubs.map((hub) => (
          <HubCard key={hub.id} hub={hub} isLive={live} />
        ))}
      </div>
    </section>
  );
}

export default async function HubsIndexPage() {
  const hubs = await listHubs(['LIVE', 'UPCOMING', 'ARCHIVED']);
  const liveHubs = hubs.filter((hub) => hub.status === 'LIVE');
  const upcomingHubs = hubs.filter((hub) => hub.status === 'UPCOMING');
  const pastHubs = hubs.filter((hub) => hub.status === 'ARCHIVED');

  return (
    <div className="container mx-auto px-4 py-6 md:py-8">
      <nav className="mb-6 text-sm">
        <Link href="/" className="text-tmc-blue hover:underline">
          Calendar
        </Link>
        <span className="mx-2 text-gray-400">/</span>
        <span className="text-gray-600 dark:text-gray-400">Festival Hubs</span>
      </nav>

      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">Festival Hubs</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-2xl">
        Major festivals have hundreds of side events. Explore hosts and schedules without cluttering the main
        calendar.
      </p>

      <HubSection
        title="Live"
        description="Festival hubs happening now."
        hubs={liveHubs}
        live
      />

      <HubSection
        title="Upcoming"
        description="Plan ahead for upcoming festivals and side events."
        hubs={upcomingHubs}
      />

      <HubSection
        title="Past"
        description="Browse previous festival hubs for past events and examples."
        hubs={pastHubs}
      />

      {hubs.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400">No festival hubs are available yet.</p>
      )}
    </div>
  );
}
