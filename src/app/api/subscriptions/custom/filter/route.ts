import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const filterSchema = z.object({
  filter: z.object({
    tags: z.array(z.string()).optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    dateRange: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
  }),
  acceptTerms: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { filter, acceptTerms } = filterSchema.parse(body);

    // Check if user has accepted terms
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { termsAcceptedAt: true },
    });

    if (!user?.termsAcceptedAt) {
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

    // Find or create CUSTOM subscription with filter
    const filterJson = JSON.stringify(filter);

    let subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        kind: 'CUSTOM',
        filter: filterJson,
      },
    });

    if (subscription) {
      // Update to ensure it's active
      subscription = await prisma.subscription.update({
        where: { id: subscription.id },
        data: { active: true },
      });
    } else {
      // Create new CUSTOM subscription with filter
      subscription = await prisma.subscription.create({
        data: {
          userId: session.user.id,
          kind: 'CUSTOM',
          active: true,
          filter: filterJson,
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
      message: 'Filter subscription created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error creating filter subscription:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

