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

    return NextResponse.json({
      connected: !!googleAccount,
      account: googleAccount
        ? {
            id: googleAccount.id,
            provider: googleAccount.provider,
            providerAccountId: googleAccount.providerAccountId,
          }
        : null,
    });
  } catch (error: any) {
    console.error('Error checking Google Calendar status:', error);
    return NextResponse.json(
      { error: 'Failed to check Google Calendar status' },
      { status: 500 }
    );
  }
}

