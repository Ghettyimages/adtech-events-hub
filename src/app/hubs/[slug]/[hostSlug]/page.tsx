import { notFound } from 'next/navigation';
import { getHostBySlug, getHubEvents, parseHubTheme } from '@/lib/hubs';
import HostPageClient from '@/components/hubs/HostPageClient';

interface PageProps {
  params: Promise<{ slug: string; hostSlug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug, hostSlug } = await params;
  const result = await getHostBySlug(slug, hostSlug);
  if (!result) return { title: 'Host not found' };
  return {
    title: `${result.host.name} at ${result.hub.name} | Festival Hubs`,
  };
}

export default async function HostPage({ params }: PageProps) {
  const { slug, hostSlug } = await params;
  const result = await getHostBySlug(slug, hostSlug);

  if (!result) {
    notFound();
  }

  const { hub, host } = result;
  const events = await getHubEvents(hub.id, { hostId: host.id });

  const serializedEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    url: e.url,
    location: e.location,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    timezone: e.timezone,
    temporalKind: e.temporalKind,
    tags: e.tags,
    source: e.source,
  }));

  return (
    <HostPageClient
      hubSlug={hub.slug}
      hubName={hub.name}
      hubTimezone={hub.timezone}
      theme={parseHubTheme(hub.theme)}
      host={{
        slug: host.slug,
        name: host.name,
        logoUrl: host.logoUrl,
        websiteUrl: host.websiteUrl,
        description: host.description,
        eventCount: host._count.events,
      }}
      events={serializedEvents}
    />
  );
}
