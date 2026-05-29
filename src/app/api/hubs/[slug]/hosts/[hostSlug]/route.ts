import { NextRequest, NextResponse } from 'next/server';
import { getHostBySlug, getHubEvents, parseHubTheme } from '@/lib/hubs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; hostSlug: string }> }
) {
  try {
    const { slug, hostSlug } = await params;
    const { searchParams } = new URL(request.url);
    const tags = searchParams.get('tags')?.split(',').filter(Boolean);
    const q = searchParams.get('q')?.trim();

    const result = await getHostBySlug(slug, hostSlug);
    if (!result) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const { hub, host } = result;
    const events = await getHubEvents(hub.id, {
      hostId: host.id,
      tags,
      q,
    });

    return NextResponse.json({
      hub: {
        slug: hub.slug,
        name: hub.name,
        theme: parseHubTheme(hub.theme),
      },
      host: {
        id: host.id,
        slug: host.slug,
        name: host.name,
        logoUrl: host.logoUrl,
        websiteUrl: host.websiteUrl,
        description: host.description,
        eventCount: host._count.events,
      },
      events,
    });
  } catch (error) {
    console.error('Error fetching host:', error);
    return NextResponse.json({ error: 'Failed to fetch host' }, { status: 500 });
  }
}
