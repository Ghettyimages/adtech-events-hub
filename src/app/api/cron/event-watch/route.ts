import { NextRequest, NextResponse } from 'next/server';
import { runDueEventWatchSources, withSchedulerRun } from '@/lib/eventWatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await withSchedulerRun(() => runDueEventWatchSources());
    const ok = result.failed === 0;
    return NextResponse.json(
      {
        success: ok,
        processed: result.processed,
        due: result.due,
        failed: result.failed,
        remaining: Math.max(0, result.due - result.processed),
        results: result.results,
      },
      { status: ok ? 200 : 502 }
    );
  } catch (error) {
    console.error('[event-watch] scheduled check failed', error);
    return NextResponse.json({ success: false, error: 'Event Watch check failed' }, { status: 500 });
  }
}
