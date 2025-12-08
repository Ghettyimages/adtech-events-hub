import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

import { z } from 'zod';

const toggleSchema = z.object({
  acceptTerms: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { acceptTerms } = toggleSchema.parse(body);

    // Check if user has accepted terms
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { termsAcceptedAt: true },
    });

    // Only check terms if activating (not deactivating)
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'FULL',
      },
    });

    const isActivating = !existingSubscription || !existingSubscription.active;

    if (isActivating && !user?.termsAcceptedAt) {
      if (!acceptTerms) {
        return NextResponse.json(
          { error: 'Terms acceptance required', requiresTerms: true },
          { status: 400 }
        );
      }
      // Update user with terms acceptance
      await prisma.user.update({
        where: { id: session.user.id },
        data: { termsAcceptedAt: new Date() },
      });
    }

    // Find or create FULL subscription
    let subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'FULL',
      },
    });

    if (subscription) {
      // Toggle active status
      subscription = await prisma.subscription.update({
        where: { id: subscription.id },
        data: { active: !subscription.active },
      });
    } else {
      // Create new FULL subscription (active by default)
      subscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'FULL',
          active: true,
        },
      });
    }

    // Get user's feedToken
    const userWithToken = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { feedToken: true },
    });

    return NextResponse.json({
      subscription,
      feedToken: userWithToken?.feedToken || null,
      message: subscription.active
        ? 'Full subscription activated'
        : 'Full subscription deactivated',
    });
  } catch (error) {
    console.error('Error toggling full subscription:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

