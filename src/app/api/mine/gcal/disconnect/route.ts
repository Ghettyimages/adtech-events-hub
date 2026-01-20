import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGoogleAuthClient } from '@/lib/gcal';

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

    if (!googleAccount) {
      return NextResponse.json(
        { error: 'Google Calendar not connected' },
        { status: 400 }
      );
    }

    // Optionally revoke tokens (best-effort)
    try {
      if (googleAccount.access_token && googleAccount.refresh_token) {
        const auth = getGoogleAuthClient(
          googleAccount.access_token,
          googleAccount.refresh_token
        );
        await auth.revokeCredentials();
      }
    } catch (error: any) {
      // Log but don't fail - revocation is best-effort
      console.warn('Failed to revoke Google tokens:', error.message);
    }

    // Clear sync state but keep Account row (so login still works)
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        gcalSyncEnabled: false,
        gcalSyncPending: false,
        gcalCalendarId: null,
        gcalLastSyncedAt: null,
        gcalLastSyncError: null,
        gcalLastSyncAttemptAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Google Calendar disconnected successfully',
    });
  } catch (error: any) {
    console.error('Error disconnecting Google Calendar:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Google Calendar', details: error.message },
      { status: 500 }
    );
  }
}

