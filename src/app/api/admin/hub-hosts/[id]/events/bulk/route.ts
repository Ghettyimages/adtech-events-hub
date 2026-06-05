import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import {
  applyBulkTagChanges,
  normalizeTags,
  parseStoredTags,
} from '@/lib/extractor/tagExtractor';

const bulkBodySchema = z
  .object({
    url: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    updateUrl: z.boolean().optional(),
    updateLocation: z.boolean().optional(),
    updateSource: z.boolean().optional(),
    addTags: z.array(z.string()).optional(),
    removeTags: z.array(z.string()).optional(),
    updateAddTags: z.boolean().optional(),
    updateRemoveTags: z.boolean().optional(),
    mode: z.enum(['only_empty', 'overwrite']).default('only_empty'),
    status: z.enum(['all', 'published', 'pending']).default('all'),
  })
  .refine(
    (body) =>
      body.updateUrl ||
      body.updateLocation ||
      body.updateSource ||
      body.updateAddTags ||
      body.updateRemoveTags,
    { message: 'Select at least one field or tag action' }
  )
  .refine(
    (body) => !body.updateAddTags || (body.addTags && normalizeTags(body.addTags).length > 0),
    { message: 'Enter at least one tag to add' }
  )
  .refine(
    (body) =>
      !body.updateRemoveTags || (body.removeTags && normalizeTags(body.removeTags).length > 0),
    { message: 'Enter at least one tag to remove' }
  );

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return null;
  }
  return session;
}

function isEmpty(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = bulkBodySchema.parse(await request.json());

    const host = await prisma.hubHost.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!host) {
      return NextResponse.json({ error: 'Host not found' }, { status: 404 });
    }

    const statusWhere: Prisma.EventWhereInput =
      body.status === 'published'
        ? { status: 'PUBLISHED' }
        : body.status === 'pending'
          ? { status: 'PENDING' }
          : { status: { in: ['PUBLISHED', 'PENDING'] } };

    const events = await prisma.event.findMany({
      where: { hubHostId: id, ...statusWhere },
      select: { id: true, url: true, location: true, source: true, tags: true },
    });

    const addTags = body.updateAddTags ? normalizeTags(body.addTags ?? []) : [];
    const removeTags = body.updateRemoveTags ? normalizeTags(body.removeTags ?? []) : [];
    const overwrite = body.mode === 'overwrite';

    let updated = 0;

    for (const event of events) {
      const data: Prisma.EventUpdateInput = {};

      if (body.updateUrl && body.url !== undefined) {
        if (overwrite || isEmpty(event.url)) {
          data.url = body.url;
        }
      }
      if (body.updateLocation && body.location !== undefined) {
        if (overwrite || isEmpty(event.location)) {
          data.location = body.location;
        }
      }
      if (body.updateSource && body.source !== undefined) {
        if (overwrite || isEmpty(event.source)) {
          data.source = body.source;
        }
      }

      if (addTags.length > 0 || removeTags.length > 0) {
        const current = parseStoredTags(event.tags);
        const { tags: nextTags, changed } = applyBulkTagChanges(current, addTags, removeTags);
        if (changed) {
          data.tags = nextTags.length > 0 ? JSON.stringify(nextTags) : null;
        }
      }

      if (Object.keys(data).length > 0) {
        await prisma.event.update({ where: { id: event.id }, data });
        updated++;
      }
    }

    return NextResponse.json({ updated, total: events.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: 'Failed to bulk update events' }, { status: 500 });
  }
}
