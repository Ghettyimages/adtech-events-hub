import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const unfollowSchema = z.object({
  eventId: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { eventId } = unfollowSchema.parse(body);

    // Find and delete EventFollow
    const eventFollow = await prisma.eventFollow.findUnique({
      where: {
        userId_eventId: {
          userId: session.user.id,
          eventId,
        },
      },
    });

    if (!eventFollow) {
      return NextResponse.json(
        { error: 'Not following this event' },
        { status: 404 }
      );
    }

    await prisma.eventFollow.delete({
      where: {
        id: eventFollow.id,
      },
    });

    // Decrement event subscriber counter
    await prisma.event.update({
      where: { id: eventId },
      data: {
        subscribers: {
          decrement: 1,
        },
      },
    });

    return NextResponse.json({
      message: 'Event unfollowed successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error unfollowing event:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

