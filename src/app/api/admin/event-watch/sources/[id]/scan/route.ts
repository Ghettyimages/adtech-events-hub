import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { runEventWatchSource } from '@/lib/eventWatch';
import type { CheckTrigger } from '@/lib/eventWatchLogic';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const trigger: CheckTrigger = body?.mode === 'full' ? 'FORCE_FULL' : 'MANUAL';
    const result = await runEventWatchSource(id, { trigger });
    return NextResponse.json(
      { success: result.ok, result, ...(result.ok ? {} : { error: result.summary }) },
      { status: result.ok ? 200 : 502 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Event Watch scan failed';
    const status = message.includes('already running') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
