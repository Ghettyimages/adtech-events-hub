import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';

interface Filter {
  tags?: string[];
  country?: string;
  region?: string;
  city?: string;
  dateRange?: {
    start?: string;
    end?: string;
  };
}

function applyFilter(events: any[], filter: Filter): any[] {
  let filtered = events;

  // Filter by tags
  if (filter.tags && filter.tags.length > 0) {
    filtered = filtered.filter((event) => {
      if (!event.tags) return false;
      try {
        const eventTags = JSON.parse(event.tags);
        if (!Array.isArray(eventTags)) return false;
        return filter.tags!.some((tag) => eventTags.includes(tag));
      } catch {
        return false;
      }
    });
  }

  // Filter by country
  if (filter.country) {
    filtered = filtered.filter((event) => event.country === filter.country);
  }

  // Filter by region
  if (filter.region) {
    filtered = filtered.filter((event) => event.region === filter.region);
  }

  // Filter by city
  if (filter.city) {
    filtered = filtered.filter((event) => 
      event.city && event.city.toLowerCase().includes(filter.city!.toLowerCase())
    );
  }

  // Filter by date range
  if (filter.dateRange) {
    if (filter.dateRange.start) {
      const startDate = new Date(filter.dateRange.start);
      filtered = filtered.filter((event) => new Date(event.start) >= startDate);
    }
    if (filter.dateRange.end) {
      const endDate = new Date(filter.dateRange.end);
      filtered = filtered.filter((event) => new Date(event.end) <= endDate);
    }
  }

  return filtered;
}

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

    // Get events from filter-based subscriptions
    const filterSubscriptions = user.subscriptions.filter((sub) => sub.filter);
    if (filterSubscriptions.length > 0) {
      // Get all PUBLISHED events
      const allPublishedEvents = await prisma.event.findMany({
        where: { status: 'PUBLISHED' },
      });

      // Apply each filter and combine results
      const filterEventIds = new Set<string>();
      for (const subscription of filterSubscriptions) {
        try {
          const filter: Filter = JSON.parse(subscription.filter!);
          const filteredEvents = applyFilter(allPublishedEvents, filter);
          filteredEvents.forEach((event) => filterEventIds.add(event.id));
        } catch (error) {
          console.error('Error parsing filter:', error);
        }
      }

      // Get events that match any filter
      const filterEvents = allPublishedEvents.filter((event) =>
        filterEventIds.has(event.id)
      );
      eventsToInclude.push(...filterEvents);
    }

    // Get events from EventFollow (manual follows)
    const followedEvents = user.eventFollows
      .map((follow) => follow.event)
      .filter((event) => event.status === 'PUBLISHED');

    // Combine and deduplicate
    const eventMap = new Map<string, any>();
    [...eventsToInclude, ...followedEvents].forEach((event) => {
      eventMap.set(event.id, event);
    });

    const finalEvents = Array.from(eventMap.values()).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    // Create iCal calendar
    const calendar: ICalCalendar = ical({
      name: 'AdTech Events Hub - My Calendar',
      description: 'Your custom event subscriptions',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    // Add events to calendar
    finalEvents.forEach((event) => {
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
        'Content-Disposition': 'attachment; filename="adtech-events-custom.ics"',
      },
    });
  } catch (error: any) {
    console.error('Error generating custom feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}

