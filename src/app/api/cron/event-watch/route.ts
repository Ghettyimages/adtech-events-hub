import { NextRequest, NextResponse } from 'next/server';
import { runDueEventWatchSources } from '@/lib/eventWatch';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runDueEventWatchSources(10);
  return NextResponse.json({ success: true, processed: results.length, results });
}
