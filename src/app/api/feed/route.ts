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
      name: 'The Media Calendar',
      description: 'The one-stop-shop for all adtech and media events',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    // Add events to calendar - all events are treated as all-day events
    events.forEach((event) => {
      // All events sync as all-day events
      const isAllDay = true;
      
      // iCal uses exclusive end dates (day after last day)
      const endDate = new Date(event.end);
      const endYear = endDate.getUTCFullYear();
      const endMonth = endDate.getUTCMonth();
      const endDay = endDate.getUTCDate();
      const exclusiveEndDate = new Date(Date.UTC(endYear, endMonth, endDay + 1, 12, 0, 0, 0));
      
      calendar.createEvent({
        start: new Date(event.start),
        end: exclusiveEndDate,
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        url: event.url || undefined,
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
