import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has Google account connected
    const googleAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: 'google',
      },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
      },
    });

    // Get user's Google Calendar sync state
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        gcalCalendarId: true,
        gcalSyncEnabled: true,
        gcalSyncPending: true,
        gcalSyncMode: true,
        gcalLastSyncedAt: true,
        gcalLastSyncError: true,
        gcalLastSyncAttemptAt: true,
      },
    });

    // "connected" means: has Google account AND has calendar sync enabled
    // This distinguishes between "logged in with Google" vs "Google Calendar integration active"
    const responseData = {
      connected: !!googleAccount && (dbUser?.gcalSyncEnabled || false),
      account: googleAccount
        ? {
            id: googleAccount.id,
            provider: googleAccount.provider,
            providerAccountId: googleAccount.providerAccountId,
          }
        : null,
      sync: {
        enabled: dbUser?.gcalSyncEnabled || false,
        pending: dbUser?.gcalSyncPending || false,
        mode: dbUser?.gcalSyncMode || 'FULL',
        calendarId: dbUser?.gcalCalendarId || null,
        lastSyncedAt: dbUser?.gcalLastSyncedAt?.toISOString() || null,
        lastSyncError: dbUser?.gcalLastSyncError || null,
        lastSyncAttemptAt: dbUser?.gcalLastSyncAttemptAt?.toISOString() || null,
      },
    };

    console.log('🔍 Status endpoint response:', JSON.stringify(responseData, null, 2));
    console.log('🔍 Google account found:', !!googleAccount);
    console.log('🔍 User sync state:', {
      enabled: dbUser?.gcalSyncEnabled,
      pending: dbUser?.gcalSyncPending,
      calendarId: dbUser?.gcalCalendarId,
    });

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('Error checking Google Calendar status:', error);
    return NextResponse.json(
      { error: 'Failed to check Google Calendar status' },
      { status: 500 }
    );
  }
}

