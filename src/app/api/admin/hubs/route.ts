import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hubs = await prisma.eventHub.findMany({
    orderBy: [{ sortOrder: 'asc' }, { start: 'desc' }],
    include: {
      hosts: {
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { events: true } } },
      },
      _count: { select: { events: true } },
    },
  });

  return NextResponse.json({ hubs });
}

const createHubSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().optional(),
  description: z.string().optional(),
  start: z.string(),
  end: z.string(),
  timezone: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(['DRAFT', 'UPCOMING', 'LIVE', 'ARCHIVED']).optional(),
  theme: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = createHubSchema.parse(await request.json());
    const hub = await prisma.eventHub.create({
      data: {
        slug: body.slug,
        name: body.name,
        tagline: body.tagline ?? null,
        description: body.description ?? null,
        start: new Date(body.start),
        end: new Date(body.end),
        timezone: body.timezone ?? null,
        location: body.location ?? null,
        status: body.status ?? 'DRAFT',
        theme: body.theme ?? null,
      },
    });
    return NextResponse.json({ hub }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: 'Failed to create hub' }, { status: 500 });
  }
}
