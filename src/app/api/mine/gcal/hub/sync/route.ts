import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { provisionAndSyncHub } from '@/lib/hubGcal';
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

    const result = await provisionAndSyncHub(session.user.id, hub.id);

    if (result.errors.length > 0 && result.synced === 0 && !result.calendarId) {
      return NextResponse.json(
        { error: result.errors[0], errors: result.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      hubName: hub.name,
      synced: result.synced,
      removed: result.removed,
      calendarId: result.calendarId,
      errors: result.errors,
      message: `Synced ${result.synced} event(s) to ${hub.name}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error syncing hub Google Calendar:', error);
    return NextResponse.json({ error: 'Failed to sync hub calendar' }, { status: 500 });
  }
}
