import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';
import { parseFilter, type Filter } from '@/lib/filters';
import { applyFilter } from '@/lib/filters-server';
import { addEventToICalCalendar } from '@/lib/icalEvent';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { feedToken: token },
      include: {
        eventFollows: {
          include: {
            event: true,
          },
        },
        subscriptions: {
          where: {
            kind: 'CUSTOM',
            active: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    let eventsToInclude: any[] = [];

    const filterSubscriptions = user.subscriptions.filter((sub) => sub.filter);
    if (filterSubscriptions.length > 0) {
      const allPublishedEvents = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
      });

      const filterEventIds = new Set<string>();
      for (const subscription of filterSubscriptions) {
        try {
          const filter = parseFilter(subscription.filter!) as Filter;
          const filteredEvents = await applyFilter(allPublishedEvents, filter);
          filteredEvents.forEach((event) => filterEventIds.add(event.id));
        } catch (error) {
          console.error('Error parsing filter:', error);
        }
      }

      const filterEvents = allPublishedEvents.filter((event) =>
        filterEventIds.has(event.id)
      );
      eventsToInclude.push(...filterEvents);
    }

    const followedEvents = user.eventFollows
      .map((follow) => follow.event)
      .filter((event) => event.status === 'PUBLISHED');

    const eventMap = new Map<string, any>();
    [...eventsToInclude, ...followedEvents].forEach((event) => {
      eventMap.set(event.id, event);
    });

    const finalEvents = Array.from(eventMap.values()).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const calendar: ICalCalendar = ical({
      name: 'The Media Calendar - My Calendar',
      description: 'Your custom event subscriptions',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    finalEvents.forEach((event) => {
      addEventToICalCalendar(calendar, event);
    });

    const icsContent = calendar.toString();

    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="adtech-events-custom.ics"',
      },
    });
  } catch (error: any) {
    console.error('Error generating custom feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}
