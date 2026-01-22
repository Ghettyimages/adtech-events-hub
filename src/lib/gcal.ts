import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
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
 * Upsert event to Google Calendar
 * Uses iCalUID to find existing events and update them
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
    // Try to find existing event by iCalUID
    // Google Calendar API supports searching by iCalUID directly
    const existingEvents = await calendar.events.list({
      calendarId,
      iCalUID,
      maxResults: 1,
    });

    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      // Update existing event
      const existingEvent = existingEvents.data.items[0];
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
    } else {
      // Create new event
      const created = await calendar.events.insert({
        calendarId,
        requestBody: {
          ...event,
          iCalUID,
        },
      });
      return created.data.id || '';
    }
  } catch (error: any) {
    // If error is due to token expiry, try to refresh
    if (error.code === 401 && refreshToken) {
      const auth = getGoogleAuthClient(accessToken, refreshToken);
      const { credentials } = await auth.refreshAccessToken();
      
      // Retry with new token
      const newCalendar = getCalendarClient(credentials.access_token!, credentials.refresh_token ?? undefined);
      
      const existingEvents = await newCalendar.events.list({
        calendarId,
        iCalUID,
        maxResults: 1,
      });

      if (existingEvents.data.items && existingEvents.data.items.length > 0) {
        const existingEvent = existingEvents.data.items[0];
        const updated = await newCalendar.events.update({
          calendarId,
          eventId: existingEvent.id!,
          requestBody: {
            ...event,
            iCalUID,
            id: existingEvent.id,
          },
        });
        return updated.data.id || '';
      } else {
        const created = await newCalendar.events.insert({
          calendarId,
          requestBody: {
            ...event,
            iCalUID,
          },
        });
        return created.data.id || '';
      }
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
 * Convert our Event model to Google Calendar event format
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

  return {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: event.timezone || 'UTC',
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: event.timezone || 'UTC',
    },
    iCalUID: generateEventICalUID(event.id),
    source: event.url
      ? {
          title: 'AdTech Events Hub',
          url: event.url,
        }
      : undefined,
  };
}

/**
 * Ensure a dedicated calendar exists for a user
 * Creates the calendar if it doesn't exist, returns the calendar ID
 * Checks for existing calendars first to prevent duplicates
 */
export async function ensureDedicatedCalendar(
  accessToken: string,
  refreshToken: string | undefined
): Promise<string> {
  const calendar = getCalendarClient(accessToken, refreshToken);

  try {
    // FIRST: Check if calendar already exists by listing calendars
    // This prevents creating duplicate calendars
    const calendars = await calendar.calendarList.list();
    const existingCalendar = calendars.data.items?.find(
      (cal) => cal.summary === 'The Media Calendar'
    );
    
    if (existingCalendar?.id) {
      console.log('Found existing "The Media Calendar", reusing:', existingCalendar.id);
      return existingCalendar.id;
    }

    // Only create if no existing calendar found
    console.log('No existing "The Media Calendar" found, creating new one...');
    const created = await calendar.calendars.insert({
      requestBody: {
        summary: 'The Media Calendar',
        description: 'Synced events from themediacalendar.com',
        timeZone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
      },
    });

    console.log('Created new "The Media Calendar":', created.data.id);
    return created.data.id!;
  } catch (error: any) {
    // If creation fails with 409 (already exists), try to find it again
    // This handles race conditions where calendar was created between our check and creation
    if (error.code === 409 || error.message?.includes('already exists')) {
      console.warn('Calendar creation conflict (409), searching for existing calendar...');
      try {
        const calendars = await calendar.calendarList.list();
        const mediaCalendar = calendars.data.items?.find(
          (cal) => cal.summary === 'The Media Calendar'
        );
        if (mediaCalendar?.id) {
          console.log('Found calendar after conflict:', mediaCalendar.id);
          return mediaCalendar.id;
        }
      } catch (listError: any) {
        console.error('Failed to list calendars after creation conflict:', listError);
      }
    }
    console.error('Error ensuring dedicated calendar:', error);
    throw error;
  }
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

