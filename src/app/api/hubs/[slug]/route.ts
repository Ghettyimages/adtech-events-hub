import { NextRequest, NextResponse } from 'next/server';
import { getHubBySlug, parseHubTheme } from '@/lib/hubs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const hub = await getHubBySlug(slug);

    if (!hub) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    }

    const theme = parseHubTheme(hub.theme);

    return NextResponse.json(
      {
        hub: {
          ...hub,
          theme,
          eventCount: hub._count.events,
          hostCount: hub.hosts.length,
          hosts: hub.hosts.map((host) => ({
            id: host.id,
            slug: host.slug,
            name: host.name,
            logoUrl: host.logoUrl,
            websiteUrl: host.websiteUrl,
            description: host.description,
            featured: host.featured,
            sortOrder: host.sortOrder,
            eventCount: host._count.events,
          })),
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching hub:', error);
    return NextResponse.json({ error: 'Failed to fetch hub' }, { status: 500 });
  }
}
