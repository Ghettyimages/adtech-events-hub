import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { parseHostSchedule } from '@/lib/scheduleParser';

const parseBodySchema = z.object({
  rawText: z.string().min(1),
  hubSlug: z.string().min(1).optional(),
  hostName: z.string().min(1),
  defaultTimezone: z.string().optional().default('Europe/Paris'),
  sourceUrl: z.string().optional(),
  skipUmbrellaEvents: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body = parseBodySchema.parse(await request.json());
    const result = await parseHostSchedule({
      rawText: body.rawText,
      hubSlug: body.hubSlug,
      hostName: body.hostName,
      defaultTimezone: body.defaultTimezone,
      sourceUrl: body.sourceUrl,
      skipUmbrellaEvents: body.skipUmbrellaEvents,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : 'Parse failed';
    console.error('[import-schedule/parse]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
