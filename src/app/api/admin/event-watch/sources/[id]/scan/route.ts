import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { runEventWatchSource } from '@/lib/eventWatch';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  try {
    const { id } = await params;
    const result = await runEventWatchSource(id);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Event Watch scan failed';
    const status = message.includes('already running') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
