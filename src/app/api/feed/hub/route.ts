import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import ical, { ICalCalendar } from 'ical-generator';
import { parseFilter, type Filter } from '@/lib/filters';
import { applyFilter } from '@/lib/filters-server';
import { getHubFeedPrefix, parseHubTheme } from '@/lib/hubs';
import { addEventToICalCalendar } from '@/lib/icalEvent';
import { FESTIVAL_HUB_DEFAULT_ZONE } from '@/lib/eventTemporal';

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

    let feedTimezone = FESTIVAL_HUB_DEFAULT_ZONE;

    for (const slug of hubSlugs) {
      const hub = await prisma.eventHub.findUnique({
        where: { slug },
        select: { id: true, name: true, theme: true, timezone: true },
      });
      if (!hub) continue;

      if (hub.timezone) {
        feedTimezone = hub.timezone;
      }

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
      timezone: feedTimezone,
      url: process.env.SITE_URL || 'http://localhost:3000',
    });

    finalEvents.forEach((event) => {
      addEventToICalCalendar(calendar, event);
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
