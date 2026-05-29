import { NextRequest, NextResponse } from 'next/server';
import { getHostBySlug, getHostPreviewEvents } from '@/lib/hubs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; hostSlug: string }> }
) {
  try {
    const { slug, hostSlug } = await params;
    const result = await getHostBySlug(slug, hostSlug);
    if (!result) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const events = await getHostPreviewEvents(result.host.id, 3);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching host preview:', error);
    return NextResponse.json({ error: 'Failed to fetch preview' }, { status: 500 });
  }
}
