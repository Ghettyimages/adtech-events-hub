import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  ensureDedicatedCalendar,
  upsertEventToGoogleCalendar,
  deleteEventFromGoogleCalendar,
  convertEventToGoogleCalendar,
  generateEventICalUID,
  refreshAndUpdateToken,
} from '@/lib/gcal';

export async function GET(request: NextRequest) {
  try {
    // Authenticate with CRON_SECRET
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron secret not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get users that need syncing (batch size limit for safety)
    const usersToSync = await prisma.user.findMany({
      where: {
        gcalSyncEnabled: true,
        gcalSyncPending: true,
      },
      take: 50, // Process 50 users per cron run
      select: {
        id: true,
        gcalCalendarId: true,
        gcalLastSyncedAt: true,
      },
    });

    const results = {
      processed: 0,
      synced: 0,
      errors: [] as string[],
    };

    for (const user of usersToSync) {
      try {
        // Get Google account
        const googleAccount = await prisma.account.findFirst({
          where: {
            userId: user.id,
            provider: 'google',
          },
        });

        if (!googleAccount || !googleAccount.access_token) {
          results.errors.push(`User ${user.id}: No Google account or access token`);
          // Disable sync for this user
          await prisma.user.update({
            where: { id: user.id },
            data: {
              gcalSyncEnabled: false,
              gcalSyncPending: false,
              gcalLastSyncError: 'No Google account or access token',
              gcalLastSyncAttemptAt: new Date(),
            },
          });
          continue;
        }

        let accessToken = googleAccount.access_token;
        let refreshToken = googleAccount.refresh_token || undefined;
        let calendarId = user.gcalCalendarId;

        // Ensure calendar exists
        if (!calendarId) {
          try {
            calendarId = await ensureDedicatedCalendar(accessToken, refreshToken);
            await prisma.user.update({
              where: { id: user.id },
              data: { gcalCalendarId: calendarId },
            });
          } catch (error: any) {
            results.errors.push(`User ${user.id}: Failed to ensure calendar: ${error.message}`);
            await prisma.user.update({
              where: { id: user.id },
              data: {
                gcalLastSyncError: `Failed to ensure calendar: ${error.message}`,
                gcalLastSyncAttemptAt: new Date(),
              },
            });
            continue;
          }
        }

        // Handle token refresh if needed
        try {
          // Check if token is expired (simple check - expires_at is in seconds)
          const now = Math.floor(Date.now() / 1000);
          if (googleAccount.expires_at && googleAccount.expires_at <= now + 60) {
            // Token expires within 60 seconds, refresh it
            const refreshed = await refreshAndUpdateToken(
              googleAccount.id,
              accessToken,
              refreshToken
            );
            accessToken = refreshed.accessToken;
            refreshToken = refreshed.refreshToken;
          }
        } catch (error: any) {
          // If refresh fails, try to continue with existing token
          console.warn(`Token refresh failed for user ${user.id}:`, error.message);
        }

        // Incremental sync: get events updated since last sync
        const lastSyncedAt = user.gcalLastSyncedAt || new Date(0);
        const eventsToSync = await prisma.event.findMany({
          where: {
            status: 'PUBLISHED',
            updatedAt: {
              gte: lastSyncedAt,
            },
          },
        });

        // Also get all currently published events to check for deletions
        const allPublishedEvents = await prisma.event.findMany({
          where: { status: 'PUBLISHED' },
          select: { id: true },
        });
        const publishedEventIds = new Set(allPublishedEvents.map((e) => e.id));

        // Sync events (upsert)
        let syncedCount = 0;
        for (const event of eventsToSync) {
          try {
            const gcalEvent = convertEventToGoogleCalendar(event);
            await upsertEventToGoogleCalendar(accessToken, refreshToken, calendarId, gcalEvent);
            syncedCount++;
          } catch (error: any) {
            results.errors.push(`User ${user.id}, Event ${event.id}: ${error.message}`);
          }
        }

        // Handle deletions: if we have a lastSyncedAt, check for events that were PUBLISHED
        // but are now not (this is a simplified approach - in production you might want
        // to track which events were synced per user)
        if (user.gcalLastSyncedAt) {
          // For now, we'll skip deletion tracking as it requires more complex state management
          // This can be enhanced later with a UserEventSync table
        }

        // Update user state
        await prisma.user.update({
          where: { id: user.id },
          data: {
            gcalSyncPending: false,
            gcalLastSyncedAt: new Date(),
            gcalLastSyncError: null,
            gcalLastSyncAttemptAt: new Date(),
          },
        });

        results.processed++;
        results.synced += syncedCount;
      } catch (error: any) {
        results.errors.push(`User ${user.id}: ${error.message}`);
        // Mark sync attempt but keep pending for retry
        await prisma.user.update({
          where: { id: user.id },
          data: {
            gcalLastSyncError: error.message,
            gcalLastSyncAttemptAt: new Date(),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} users, synced ${results.synced} events`,
      ...results,
    });
  } catch (error: any) {
    console.error('Error in cron sync:', error);
    return NextResponse.json(
      { error: 'Failed to sync', details: error.message },
      { status: 500 }
    );
  }
}

