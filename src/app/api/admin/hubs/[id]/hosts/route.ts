import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const createHostSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  logoUrl: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sourceAlias: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: hubId } = await params;
    const body = createHostSchema.parse(await request.json());

    const host = await prisma.hubHost.create({
      data: {
        hubId,
        slug: body.slug,
        name: body.name,
        logoUrl: body.logoUrl ?? null,
        websiteUrl: body.websiteUrl ?? null,
        description: body.description ?? null,
        sourceAlias: body.sourceAlias ?? null,
        featured: body.featured ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return NextResponse.json({ host }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create host' }, { status: 500 });
  }
}
