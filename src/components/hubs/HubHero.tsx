import { format } from 'date-fns';
import type { HubSummary } from '@/lib/hubs-client';

interface HubHeroProps {
  hub: HubSummary;
  onSubscribe?: () => void;
  subscribeLabel?: string;
}

export default function HubHero({ hub, onSubscribe, subscribeLabel }: HubHeroProps) {
  const start = new Date(hub.start);
  const end = new Date(hub.end);
  const gradient =
    hub.theme?.heroGradient ||
    'linear-gradient(135deg, #0B2A66 0%, #1a4a8a 50%, #C9A227 100%)';

  return (
    <div
      className="rounded-xl text-white p-6 md:p-10 mb-8 shadow-lg"
      style={{ background: gradient }}
    >
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider opacity-90 mb-1">Festival Hub</p>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{hub.name}</h1>
          {hub.tagline && <p className="text-lg opacity-95 max-w-2xl">{hub.tagline}</p>}
          <p className="mt-3 text-sm opacity-90">
            {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')}
            {hub.location && ` · ${hub.location}`}
          </p>
          <p className="mt-1 text-sm font-medium">
            {hub.eventCount} events · {hub.hostCount} hosts
          </p>
        </div>
        {onSubscribe && (
          <button
            type="button"
            onClick={onSubscribe}
            className="shrink-0 bg-white text-tmc-navy px-6 py-3 rounded-lg font-semibold hover:bg-slate-50 transition min-h-[44px]"
          >
            {subscribeLabel ?? `Subscribe to ${hub.theme?.label ?? 'hub'}`}
          </button>
        )}
      </div>
    </div>
  );
}
