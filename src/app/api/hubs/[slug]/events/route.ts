import { NextRequest, NextResponse } from 'next/server';
import { getHubBySlug, getHubEvents } from '@/lib/hubs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const tags = searchParams.get('tags')?.split(',').filter(Boolean);
    const q = searchParams.get('q')?.trim();
    const hostSlug = searchParams.get('host');

    const hub = await getHubBySlug(slug);
    if (!hub) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    }

    let hostId: string | undefined;
    if (hostSlug) {
      const host = hub.hosts.find((h) => h.slug === hostSlug);
      if (!host) {
        return NextResponse.json({ error: 'Host not found' }, { status: 404 });
      }
      hostId = host.id;
    }

    const events = await getHubEvents(hub.id, { hostId, tags, q });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching hub events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}
