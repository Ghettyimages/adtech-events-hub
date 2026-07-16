import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

/** Distinct Event.source values for admin source pickers. */
export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const rows = await prisma.event.findMany({
      where: {
        source: { not: null },
        NOT: { source: '' },
      },
      select: { source: true },
      distinct: ['source'],
      orderBy: { source: 'asc' },
    });

    const sources = rows
      .map((r) => r.source?.trim())
      .filter((s): s is string => Boolean(s));

    return NextResponse.json({ sources });
  } catch (error) {
    console.error('[admin/sources]', error);
    return NextResponse.json({ error: 'Failed to list sources' }, { status: 500 });
  }
}
