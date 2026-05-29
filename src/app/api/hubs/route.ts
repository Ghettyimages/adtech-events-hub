import { NextRequest, NextResponse } from 'next/server';
import { listHubs, type HubStatus } from '@/lib/hubs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');

    let statuses: HubStatus[] | undefined;
    if (statusParam) {
      statuses = statusParam.split(',').map((s) => s.trim()) as HubStatus[];
    }

    const hubs = await listHubs(statuses);

    return NextResponse.json(
      { hubs },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching hubs:', error);
    return NextResponse.json({ error: 'Failed to fetch hubs' }, { status: 500 });
  }
}
