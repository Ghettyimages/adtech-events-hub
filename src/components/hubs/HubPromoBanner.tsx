import Link from 'next/link';
import { listHubs, parseHubTheme } from '@/lib/hubs';

export default async function HubPromoBanner() {
  const hubs = await listHubs(['UPCOMING', 'LIVE']);
  const featured = hubs[0];
  if (!featured) return null;

  const theme = parseHubTheme(featured.theme);
  const gradient =
    theme.heroGradient ||
    'linear-gradient(90deg, #0B2A66 0%, #145AC6 50%, #C9A227 100%)';

  return (
    <div
      className="mb-8 rounded-xl p-4 md:p-5 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-md"
      style={{ background: gradient }}
    >
      <div>
        <p className="text-xs uppercase tracking-wider opacity-90">Festival Hub</p>
        <p className="font-semibold text-lg">{featured.name}</p>
        <p className="text-sm opacity-90">
          {featured._count.events} events · {featured._count.hosts} hosts
        </p>
      </div>
      <Link
        href={`/hubs/${featured.slug}`}
        className="inline-flex items-center justify-center bg-white text-tmc-navy px-5 py-2.5 rounded-lg font-semibold hover:bg-slate-50 transition shrink-0 min-h-[44px]"
      >
        Explore Cannes →
      </Link>
    </div>
  );
}
