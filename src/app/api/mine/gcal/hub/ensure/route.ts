import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  getGoogleTokensForUser,
  provisionAndClaimHubCalendar,
  ensureHubCalendarSyncRow,
} from '@/lib/hubGcal';
import { z } from 'zod';

const schema = z.object({
  hubSlug: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hubSlug } = schema.parse(body);

    const hub = await prisma.eventHub.findUnique({
      where: { slug: hubSlug },
      select: { id: true, name: true },
    });
    if (!hub) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    }

    const tokens = await getGoogleTokensForUser(session.user.id);
    if (!tokens) {
      return NextResponse.json(
        { error: 'Google Calendar not connected. Please connect your Google account first.' },
        { status: 400 }
      );
    }

    await ensureHubCalendarSyncRow(session.user.id, hub.id);

    const result = await provisionAndClaimHubCalendar(
      session.user.id,
      hub.id,
      tokens.accessToken,
      tokens.refreshToken
    );

    await prisma.hubCalendarSync.update({
      where: { userId_hubId: { userId: session.user.id, hubId: hub.id } },
      data: { gcalSyncPending: true },
    });

    return NextResponse.json({
      success: true,
      calendarId: result.calendarId,
      action: result.action,
      hubName: hub.name,
      message: `Festival calendar "${hub.name}" ready`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error ensuring hub Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to ensure hub calendar' }, { status: 500 });
  }
}
