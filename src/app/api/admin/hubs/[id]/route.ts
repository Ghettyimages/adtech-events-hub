import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const updateHubSchema = z.object({
  name: z.string().optional(),
  tagline: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  timezone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.enum(['DRAFT', 'UPCOMING', 'LIVE', 'ARCHIVED']).optional(),
  theme: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = updateHubSchema.parse(await request.json());

    const data: Record<string, unknown> = { ...body };
    if (body.start) data.start = new Date(body.start);
    if (body.end) data.end = new Date(body.end);

    const hub = await prisma.eventHub.update({
      where: { id },
      data,
    });

    return NextResponse.json({ hub });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update hub' }, { status: 500 });
  }
}
