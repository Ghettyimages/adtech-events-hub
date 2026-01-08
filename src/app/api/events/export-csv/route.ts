import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import Papa from 'papaparse';

export async function GET(request: NextRequest) {
  try {
    const events = await prisma.event.findMany({
      orderBy: { start: 'asc' },
    });

    // Convert to CSV format
    const csvData = events.map(event => ({
      title: event.title,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      location: event.location || '',
      url: event.url || '',
      description: event.description || '',
      timezone: event.timezone || 'America/New_York',
      source: event.source || '',
      status: event.status,
      tags: event.tags || '',
      country: event.country || '',
      region: event.region || '',
      city: event.city || '',
    }));

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

