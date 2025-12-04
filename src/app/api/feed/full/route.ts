import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 401 });
    }

    // Find user by feedToken
    const user = await prisma.user.findUnique({
      where: { feedToken: token },
      include: {
        subscriptions: {
          where: {
            kind: 'FULL',
            active: true,
          },
        },
      },
    });

    if (!user || user.subscriptions.length === 0) {
      return NextResponse.json(
        { error: 'Full subscription not active' },
        { status: 403 }
      );
    }

    // Fetch all published events
    const events = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { start: 'asc' },
    });

    // Create iCal calendar
    const calendar: ICalCalendar = ical({
      name: 'AdTech Events Hub - Full Calendar',
      description: 'Full Media Calendar subscription',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    // Add events to calendar
    events.forEach((event) => {
      calendar.createEvent({
        start: new Date(event.start),
        end: new Date(event.end),
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        url: event.url || undefined,
        timezone: event.timezone || undefined,
      });
    });

    // Generate iCal string
    const icsContent = calendar.toString();

    // Return as downloadable .ics file
    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="adtech-events-full.ics"',
      },
    });
  } catch (error: any) {
    console.error('Error generating full feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}

