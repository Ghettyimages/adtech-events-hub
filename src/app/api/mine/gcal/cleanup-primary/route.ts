import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getCalendarClient, generateEventICalUID } from '@/lib/gcal';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's Google account
    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: 'google',
      },
    });

    if (!googleAccount || !googleAccount.access_token) {
      return NextResponse.json(
        { error: 'Google Calendar not connected' },
        { status: 400 }
      );
    }

    const calendar = getCalendarClient(
      googleAccount.access_token,
      googleAccount.refresh_token || undefined
    );

    // Get all published events from our database
    const allEvents = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true },
    });

    const results = {
      found: 0,
      deleted: 0,
      errors: [] as string[],
    };

    // For each event, try to find and delete it from primary calendar
    for (const event of allEvents) {
      try {
        const iCalUID = generateEventICalUID(event.id);

        // Search for events with this iCalUID in primary calendar
        const existingEvents = await calendar.events.list({
          calendarId: 'primary',
          iCalUID,
          maxResults: 1,
        });

        if (existingEvents.data.items && existingEvents.data.items.length > 0) {
          results.found++;
          try {
            await calendar.events.delete({
              calendarId: 'primary',
              eventId: existingEvents.data.items[0].id!,
            });
            results.deleted++;
          } catch (deleteError: any) {
            results.errors.push(`Failed to delete "${event.title}": ${deleteError.message}`);
          }
        }
      } catch (error: any) {
        results.errors.push(`Error processing "${event.title}": ${error.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Found ${results.found} event(s) in primary calendar, deleted ${results.deleted}`,
      ...results,
    });
  } catch (error: any) {
    console.error('Error cleaning up primary calendar:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup primary calendar', details: error.message },
      { status: 500 }
    );
  }
}

