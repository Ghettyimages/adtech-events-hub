import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  checkInterval: z
    .number()
    .int()
    .min(60 * 60 * 1000)
    .max(30 * 24 * 60 * 60 * 1000)
    .optional(),
  adapterType: z.string().trim().min(1).max(50).optional(),
  authority: z.string().trim().min(1).max(50).optional(),
  region: z.string().trim().max(100).nullable().optional(),
  topics: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  try {
    const { id } = await params;
    const input = updateSchema.parse(await request.json());
    const source = await prisma.monitoredUrl.update({
      where: { id },
      data: {
        ...input,
        topics: input.topics === undefined ? undefined : JSON.stringify(input.topics),
        nextCheckAt: input.enabled === true ? new Date() : undefined,
      },
    });
    return NextResponse.json({ source });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid source update', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Unable to update source' }, { status: 400 });
  }
}
