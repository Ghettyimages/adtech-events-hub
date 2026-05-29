import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';
import { addEventToICalCalendar } from '@/lib/icalEvent';

export async function GET(request: NextRequest) {
  try {
    // Fetch all published events
    const events = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { start: 'asc' },
    });

    // Create iCal calendar
    const calendar: ICalCalendar = ical({
      name: 'The Media Calendar',
      description: 'The one-stop-shop for all adtech and media events',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    events.forEach((event) => {
      addEventToICalCalendar(calendar, event);
    });

    // Generate iCal string
    const icsContent = calendar.toString();

    // Return as downloadable .ics file
    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="adtech-events.ics"',
      },
    });
  } catch (error: any) {
    console.error('Error generating iCal feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}
