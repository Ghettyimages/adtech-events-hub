import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';
import { parseFilter, type Filter } from '@/lib/filters';
import { applyFilter } from '@/lib/filters-server';
import { getHubFeedPrefix, parseHubTheme } from '@/lib/hubs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const hubSlugParam = searchParams.get('hub');

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { feedToken: token },
      include: {
        subscriptions: {
          where: {
            kind: 'HUB',
            active: true,
          },
        },
      },
    });

    if (!user || user.subscriptions.length === 0) {
      return NextResponse.json(
        { error: 'Hub subscription not active' },
        { status: 403 }
      );
    }

    const hubSubscriptions = user.subscriptions.filter((sub) => sub.filter);
    const eventIdSet = new Set<string>();
    const allHubEvents: Awaited<ReturnType<typeof prisma.event.findMany>> = [];

    const hubSlugs = new Set<string>();
    for (const subscription of hubSubscriptions) {
      const filter = parseFilter(subscription.filter);
      if (!filter?.hubSlug) continue;
      if (hubSlugParam && filter.hubSlug !== hubSlugParam) continue;
      hubSlugs.add(filter.hubSlug);
    }

    for (const slug of hubSlugs) {
      const hub = await prisma.eventHub.findUnique({
        where: { slug },
        select: { id: true, name: true, theme: true },
      });
      if (!hub) continue;

      const events = await prisma.event.findMany({
        where: { hubId: hub.id, status: 'PUBLISHED' },
      });

      const theme = parseHubTheme(hub.theme);
      const prefix = getHubFeedPrefix(theme, hub.name);

      for (const subscription of hubSubscriptions) {
        const filter = parseFilter(subscription.filter);
        if (!filter || filter.hubSlug !== slug) continue;

        const matched = await applyFilter(events, filter as Filter);
        matched.forEach((event) => {
          if (!eventIdSet.has(event.id)) {
            eventIdSet.add(event.id);
            allHubEvents.push({
              ...event,
              title: `${prefix} ${event.title}`,
            });
          }
        });
      }
    }

    const finalEvents = allHubEvents.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const calendar: ICalCalendar = ical({
      name: 'The Media Calendar - Festival Hub',
      description: 'Your festival hub event subscriptions',
      timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    finalEvents.forEach((event) => {
      const endDate = new Date(event.end);
      const exclusiveEndDate = new Date(
        Date.UTC(
          endDate.getUTCFullYear(),
          endDate.getUTCMonth(),
          endDate.getUTCDate() + 1,
          12,
          0,
          0,
          0
        )
      );

      calendar.createEvent({
        start: new Date(event.start),
        end: exclusiveEndDate,
        summary: event.title,
        description: event.description || undefined,
        location: event.location || undefined,
        url: event.url || undefined,
        allDay: true,
      });
    });

    const icsContent = calendar.toString();

    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="media-calendar-hub.ics"',
      },
    });
  } catch (error) {
    console.error('Error generating hub feed:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}
