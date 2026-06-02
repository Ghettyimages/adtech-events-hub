import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  appendHubTag,
  applyHubEventDefaults,
  resolveHostForIngest,
  resolveOrCreateHostByName,
} from '@/lib/hubs';

const assignSchema = z.object({
  hubId: z.string().nullable(),
  hubHostId: z.string().nullable().optional(),
  hostName: z.string().nullable().optional(),
  showOnMainCalendar: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = assignSchema.parse(await request.json());

    const existing = await prisma.event.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    let hubHostId = body.hubHostId ?? null;
    let tags = existing.tags;

    if (body.hubId) {
      // Write-in host name takes priority (match existing or create new).
      if (!hubHostId && body.hostName?.trim()) {
        hubHostId = await resolveOrCreateHostByName(body.hubId, body.hostName);
      }
      // Fall back to matching the event's source name to a host.
      if (!hubHostId && existing.source) {
        hubHostId = await resolveHostForIngest(body.hubId, existing.source);
      }
    } else {
      // Clearing the hub also clears the host.
      hubHostId = null;
    }

    if (body.hubId) {
      const hub = await prisma.eventHub.findUnique({
        where: { id: body.hubId },
        select: { slug: true },
      });
      if (hub) {
        tags = appendHubTag(tags, hub.slug);
      }
    }

    const calendarDefaults = applyHubEventDefaults({
      hubId: body.hubId,
      showOnMainCalendar: body.showOnMainCalendar,
    });

    const event = await prisma.event.update({
      where: { id },
      data: {
        hubId: body.hubId,
        hubHostId,
        tags,
        showOnMainCalendar: calendarDefaults.showOnMainCalendar,
      },
    });

    return NextResponse.json({ event });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to assign hub' }, { status: 500 });
  }
}
