import { notFound } from 'next/navigation';
import { getHubBySlug, parseHubTheme } from '@/lib/hubs';
import HubHomeClient from '@/components/hubs/HubHomeClient';
import type { HubSummary } from '@/lib/hubs-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const hub = await getHubBySlug(slug);
  if (!hub) return { title: 'Hub not found' };
  return {
    title: `${hub.name} | Festival Hubs`,
    description: hub.tagline ?? hub.description ?? undefined,
  };
}

export default async function HubPage({ params }: PageProps) {
  const { slug } = await params;
  const hub = await getHubBySlug(slug);

  if (!hub || hub.status === 'ARCHIVED') {
    notFound();
  }

  const hubSummary: HubSummary = {
    id: hub.id,
    slug: hub.slug,
    name: hub.name,
    tagline: hub.tagline,
    description: hub.description,
    start: hub.start.toISOString(),
    end: hub.end.toISOString(),
    timezone: hub.timezone,
    location: hub.location,
    status: hub.status,
    theme: parseHubTheme(hub.theme),
    eventCount: hub._count.events,
    hostCount: hub.hosts.length,
    hosts: hub.hosts.map((h) => ({
      id: h.id,
      slug: h.slug,
      name: h.name,
      logoUrl: h.logoUrl,
      websiteUrl: h.websiteUrl,
      description: h.description,
      featured: h.featured,
      eventCount: h._count.events,
    })),
  };

  return <HubHomeClient hub={hubSummary} />;
}
