import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import Papa from 'papaparse';
import { toCsvRow } from '@/lib/eventTemporal';

export async function GET(request: NextRequest) {
  try {
    const events = await prisma.event.findMany({
      orderBy: { start: 'asc' },
      include: {
        hub: { select: { slug: true, name: true, timezone: true } },
        hubHost: { select: { slug: true, name: true, websiteUrl: true } },
      },
    });

    // Convert to CSV format
    const csvData = events.map((event) => {
      const temporal = toCsvRow(event);
      return {
        title: event.title,
        start: temporal.start,
        end: temporal.end,
        location: event.location || '',
        url: event.url || '',
        description: event.description || '',
        timezone: temporal.timezone,
        all_day: temporal.all_day,
        temporal_kind: temporal.temporal_kind,
        source: event.source || '',
        sponsored_by: event.sponsoredBy || '',
        sponsor_kind: event.sponsorKind || '',
        status: event.status,
        tags: event.tags || '',
        country: event.country || '',
        region: event.region || '',
        city: event.city || '',
        hub_slug: event.hub?.slug || '',
        hub_name: event.hub?.name || '',
        hub_timezone: event.hub?.timezone || '',
        host_slug: event.hubHost?.slug || '',
        host_name: event.hubHost?.name || '',
        host_url: event.hubHost?.websiteUrl || '',
      };
    });

    const csv = Papa.unparse(csvData);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="events-export.csv"',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to export CSV: ${error.message}` },
      { status: 500 }
    );
  }
}

