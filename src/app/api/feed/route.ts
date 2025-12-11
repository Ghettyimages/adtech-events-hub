import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';

export async function GET(request: NextRequest) {
  try {
    // Fetch all published events
    const events = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { start: 'asc' },
    });

    // Create iCal calendar
    const calendar: ICalCalendar = ical({
      name: 'AdTech Events Hub',
      description: 'The one-stop-shop for all adtech and media events',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    // Add events to calendar
    events.forEach((event) => {
      // If timezone is null, it's an all-day event
      const isAllDay = !event.timezone;
      calendar.createEvent({
        start: new Date(event.start),
        end: new Date(event.end),
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        url: event.url || undefined,
        timezone: event.timezone || undefined,
        allDay: isAllDay,
      });
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
