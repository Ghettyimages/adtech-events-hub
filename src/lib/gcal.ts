import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    date: string;  // All-day event format: YYYY-MM-DD
  };
  end: {
    date: string;  // All-day event format: YYYY-MM-DD (exclusive)
  };
  iCalUID?: string;
  source?: {
    title: string;
    url: string;
  };
}

/**
 * Get OAuth2 client from stored tokens
 */
export function getGoogleAuthClient(accessToken: string, refreshToken?: string): OAuth2Client {
  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXTAUTH_URL + '/api/auth/callback/google'
  );

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return client;
}

/**
 * Get Google Calendar API client
 */
export function getCalendarClient(accessToken: string, refreshToken?: string) {
  const auth = getGoogleAuthClient(accessToken, refreshToken);
  return google.calendar({ version: 'v3', auth });
}

/**
 * Generate stable iCalUID for an event
 * This ensures we can update/delete events reliably
 */
export function generateEventICalUID(eventId: string): string {
  // Use a consistent format: event-{eventId}@adtech-events-hub
  return `event-${eventId}@adtech-events-hub`;
}

/**
 * Helper to perform the actual upsert operation with a calendar client
 */
async function performUpsert(
  calendar: ReturnType<typeof getCalendarClient>,
  calendarId: string,
  event: GoogleCalendarEvent,
  iCalUID: string
): Promise<string> {
  // Try to find existing event by iCalUID
  const existingEvents = await calendar.events.list({
    calendarId,
    iCalUID,
    maxResults: 1,
  });

  if (existingEvents.data.items && existingEvents.data.items.length > 0) {
    // Update existing event - delete and recreate to handle format changes (dateTime -> date)
    const existingEvent = existingEvents.data.items[0];
    
    try {
      // Try direct update first
      const updated = await calendar.events.update({
        calendarId,
        eventId: existingEvent.id!,
        requestBody: {
          ...event,
          iCalUID,
          id: existingEvent.id,
        },
      });
      return updated.data.id || '';
    } catch (updateError: any) {
      // If update fails (e.g., format change from dateTime to date), delete and recreate
      console.log(`Update failed for event, deleting and recreating: ${event.summary}`);
      await calendar.events.delete({
        calendarId,
        eventId: existingEvent.id!,
      });
      const created = await calendar.events.insert({
        calendarId,
        requestBody: {
          ...event,
          iCalUID,
        },
      });
      return created.data.id || '';
    }
  } else {
    // Create new event
    try {
      const created = await calendar.events.insert({
        calendarId,
        requestBody: {
          ...event,
          iCalUID,
        },
      });
      return created.data.id || '';
    } catch (insertError: any) {
      // Handle "identifier already exists" error (409)
      // This can happen if the event exists but wasn't found by iCalUID search
      if (insertError.code === 409 || insertError.message?.includes('already exists')) {
        console.log(`Event already exists, searching by summary: ${event.summary}`);
        
        // Search for the event by time range and summary
        const searchResults = await calendar.events.list({
          calendarId,
          q: event.summary,
          maxResults: 10,
        });
        
        const matchingEvent = searchResults.data.items?.find(
          (e) => e.summary === event.summary
        );
        
        if (matchingEvent?.id) {
          // Delete the old event and create new one
          await calendar.events.delete({
            calendarId,
            eventId: matchingEvent.id,
          });
          const created = await calendar.events.insert({
            calendarId,
            requestBody: {
              ...event,
              iCalUID,
            },
          });
          return created.data.id || '';
        }
      }
      throw insertError;
    }
  }
}

/**
 * Upsert event to Google Calendar
 * Uses iCalUID to find existing events and update them
 * Handles format changes (dateTime -> date) by deleting and recreating
 */
export async function upsertEventToGoogleCalendar(
  accessToken: string,
  refreshToken: string | undefined,
  calendarId: string,
  event: GoogleCalendarEvent
): Promise<string> {
  const calendar = getCalendarClient(accessToken, refreshToken);

  // Generate stable iCalUID if not provided
  const iCalUID = event.iCalUID || generateEventICalUID(event.id || '');

  try {
    return await performUpsert(calendar, calendarId, event, iCalUID);
  } catch (error: any) {
    // If error is due to token expiry, try to refresh
    if (error.code === 401 && refreshToken) {
      const auth = getGoogleAuthClient(accessToken, refreshToken);
      const { credentials } = await auth.refreshAccessToken();
      
      // Retry with new token
      const newCalendar = getCalendarClient(credentials.access_token!, credentials.refresh_token ?? undefined);
      return await performUpsert(newCalendar, calendarId, event, iCalUID);
    }
    throw error;
  }
}

/**
 * Delete event from Google Calendar by iCalUID
 */
export async function deleteEventFromGoogleCalendar(
  accessToken: string,
  refreshToken: string | undefined,
  calendarId: string,
  iCalUID: string
): Promise<void> {
  const calendar = getCalendarClient(accessToken, refreshToken);

  try {
    const existingEvents = await calendar.events.list({
      calendarId,
      iCalUID,
      maxResults: 1,
    });

    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      await calendar.events.delete({
        calendarId,
        eventId: existingEvents.data.items[0].id!,
      });
    }
  } catch (error: any) {
    if (error.code === 401 && refreshToken) {
      const auth = getGoogleAuthClient(accessToken, refreshToken);
      const { credentials } = await auth.refreshAccessToken();
      
      const newCalendar = getCalendarClient(credentials.access_token!, credentials.refresh_token ?? undefined);
      const existingEvents = await newCalendar.events.list({
        calendarId,
        iCalUID,
        maxResults: 1,
      });

      if (existingEvents.data.items && existingEvents.data.items.length > 0) {
        await newCalendar.events.delete({
          calendarId,
          eventId: existingEvents.data.items[0].id!,
        });
      }
    } else {
      throw error;
    }
  }
}

/**
 * Format a Date as YYYY-MM-DD for Google Calendar all-day events
 * Uses UTC date components to avoid timezone shifts
 */
function formatDateForGoogleCalendar(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert our Event model to Google Calendar event format
 * All events are created as all-day events using the date field (not dateTime)
 */
export function convertEventToGoogleCalendar(event: {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date | string;
  end: Date | string;
  timezone?: string | null;
  url?: string | null;
}): GoogleCalendarEvent {
  const startDate = typeof event.start === 'string' ? new Date(event.start) : event.start;
  const endDate = typeof event.end === 'string' ? new Date(event.end) : event.end;

  // Calculate exclusive end date (Google Calendar all-day events use exclusive end dates)
  // Add 1 day to the end date
  const exclusiveEndDate = new Date(endDate);
  exclusiveEndDate.setUTCDate(exclusiveEndDate.getUTCDate() + 1);

  return {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: {
      date: formatDateForGoogleCalendar(startDate),
    },
    end: {
      date: formatDateForGoogleCalendar(exclusiveEndDate),
    },
    iCalUID: generateEventICalUID(event.id),
    source: event.url
      ? {
          title: 'The Media Calendar',
          url: event.url,
        }
      : undefined,
  };
}

/**
 * Ensure a dedicated calendar exists for a user
 * Creates the calendar if it doesn't exist, returns the calendar ID
 * Checks for existing calendars first to prevent duplicates
 * 
 * NOTE: This is the low-level helper. For race-safe provisioning that claims
 * the calendar ID in the database, use `provisionAndClaimCalendar()` instead.
 */
export async function ensureDedicatedCalendar(
  accessToken: string,
  refreshToken: string | undefined
): Promise<{ calendarId: string; created: boolean }> {
  const calendar = getCalendarClient(accessToken, refreshToken);

  try {
    // FIRST: Check if calendar already exists by listing calendars
    // This prevents creating duplicate calendars
    const calendars = await calendar.calendarList.list();
    const existingCalendar = calendars.data.items?.find(
      (cal) => cal.summary === 'The Media Calendar'
    );
    
    if (existingCalendar?.id) {
      console.log('[ensureDedicatedCalendar] Reusing existing calendar:', existingCalendar.id);
      return { calendarId: existingCalendar.id, created: false };
    }

    // Only create if no existing calendar found
    console.log('[ensureDedicatedCalendar] Creating new "The Media Calendar"...');
    const created = await calendar.calendars.insert({
      requestBody: {
        summary: 'The Media Calendar',
        description: 'Synced events from themediacalendar.com',
        timeZone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      },
    });

    console.log('[ensureDedicatedCalendar] Created calendar:', created.data.id);
    return { calendarId: created.data.id!, created: true };
  } catch (error: any) {
    // If creation fails with 409 (already exists), try to find it again
    // This handles race conditions where calendar was created between our check and creation
    if (error.code === 409 || error.message?.includes('already exists')) {
      console.warn('[ensureDedicatedCalendar] Creation conflict (409), searching again...');
      try {
        const calendars = await calendar.calendarList.list();
        const mediaCalendar = calendars.data.items?.find(
          (cal) => cal.summary === 'The Media Calendar'
        );
        if (mediaCalendar?.id) {
          console.log('[ensureDedicatedCalendar] Found after conflict:', mediaCalendar.id);
          return { calendarId: mediaCalendar.id, created: false };
        }
      } catch (listError: any) {
        console.error('[ensureDedicatedCalendar] Failed to list after conflict:', listError);
      }
    }
    console.error('[ensureDedicatedCalendar] Error:', error);
    throw error;
  }
}

/**
 * Delete a calendar by ID (best-effort, logs errors but doesn't throw)
 */
async function deleteCalendarBestEffort(
  accessToken: string,
  refreshToken: string | undefined,
  calendarId: string
): Promise<void> {
  try {
    const calendar = getCalendarClient(accessToken, refreshToken);
    await calendar.calendars.delete({ calendarId });
    console.log('[deleteCalendarBestEffort] Deleted duplicate calendar:', calendarId);
  } catch (error: any) {
    console.warn('[deleteCalendarBestEffort] Failed to delete calendar:', calendarId, error.message);
    // Don't throw - this is best-effort cleanup
  }
}

/**
 * Verify a calendar ID is accessible in the user's Google account
 */
async function verifyCalendarExists(
  accessToken: string,
  refreshToken: string | undefined,
  calendarId: string
): Promise<boolean> {
  try {
    const calendar = getCalendarClient(accessToken, refreshToken);
    await calendar.calendars.get({ calendarId });
    return true;
  } catch (error: any) {
    if (error.code === 404) {
      return false;
    }
    // For other errors (auth, network), assume it might exist
    console.warn('[verifyCalendarExists] Error verifying calendar:', error.message);
    return false;
  }
}

export interface ProvisionResult {
  calendarId: string;
  action: 'existing' | 'created' | 'claimed_existing';
}

/**
 * Provision and atomically claim a dedicated calendar for a user.
 * 
 * This is the single-writer helper that prevents duplicate calendars:
 * 1. If user already has gcalCalendarId, verify it exists in Google and return it
 * 2. If missing/invalid, find or create a calendar in Google
 * 3. Atomically claim the calendarId in DB (only if still null)
 * 4. If claim fails (another request won), delete the calendar we created (if any)
 *    and return the winner's calendarId
 * 
 * @param userId - The user's database ID
 * @param accessToken - Google OAuth access token
 * @param refreshToken - Google OAuth refresh token
 * @returns The claimed calendar ID and action taken
 */
export async function provisionAndClaimCalendar(
  userId: string,
  accessToken: string,
  refreshToken: string | undefined
): Promise<ProvisionResult> {
  const { prisma } = await import('@/lib/db');

  // Step 1: Check if user already has a valid calendar ID
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalCalendarId: true },
  });

  if (user?.gcalCalendarId) {
    // Verify it still exists in Google
    const exists = await verifyCalendarExists(accessToken, refreshToken, user.gcalCalendarId);
    if (exists) {
      console.log('[provisionAndClaimCalendar] User already has valid calendar:', user.gcalCalendarId);
      return { calendarId: user.gcalCalendarId, action: 'existing' };
    }
    // Calendar doesn't exist anymore, clear it and continue to provision
    console.log('[provisionAndClaimCalendar] Stored calendar invalid, will provision new one');
    await prisma.user.update({
      where: { id: userId },
      data: { gcalCalendarId: null },
    });
  }

  // Step 2: Find or create a calendar in Google
  const { calendarId: candidateId, created: wasCreated } = await ensureDedicatedCalendar(
    accessToken,
    refreshToken
  );

  // Step 3: Atomically claim the calendar ID (only if gcalCalendarId is still null)
  // This uses updateMany which returns count instead of throwing on no-match
  const claimResult = await prisma.user.updateMany({
    where: {
      id: userId,
      gcalCalendarId: null, // Only claim if still null
    },
    data: {
      gcalCalendarId: candidateId,
      gcalSyncEnabled: true,
    },
  });

  if (claimResult.count > 0) {
    // We won the race!
    console.log('[provisionAndClaimCalendar] Claim won, calendarId:', candidateId, 'created:', wasCreated);
    return { calendarId: candidateId, action: wasCreated ? 'created' : 'claimed_existing' };
  }

  // Step 4: We lost the race - another request claimed a calendar first
  console.log('[provisionAndClaimCalendar] Claim lost (another request won)');

  // If we created a new calendar, delete it to avoid orphan duplicates
  if (wasCreated) {
    console.log('[provisionAndClaimCalendar] Deleting orphan calendar we created:', candidateId);
    await deleteCalendarBestEffort(accessToken, refreshToken, candidateId);
  }

  // Re-read user to get the winner's calendar ID
  const updatedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { gcalCalendarId: true },
  });

  if (!updatedUser?.gcalCalendarId) {
    // This shouldn't happen, but handle it gracefully
    throw new Error('Failed to claim calendar and no winner found');
  }

  console.log('[provisionAndClaimCalendar] Using winner calendarId:', updatedUser.gcalCalendarId);
  return { calendarId: updatedUser.gcalCalendarId, action: 'existing' };
}

/**
 * Refresh access token and update Account in database
 */
export async function refreshAndUpdateToken(
  accountId: string,
  accessToken: string,
  refreshToken: string | undefined
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const auth = getGoogleAuthClient(accessToken, refreshToken);
  const { credentials } = await auth.refreshAccessToken();

  // Update Account in database
  const { prisma } = await import('@/lib/db');
  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: credentials.access_token || undefined,
      refresh_token: credentials.refresh_token || refreshToken,
      expires_at: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : undefined,
    },
  });

  return {
    accessToken: credentials.access_token!,
    refreshToken: credentials.refresh_token || refreshToken,
    expiresAt: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : undefined,
  };
}

