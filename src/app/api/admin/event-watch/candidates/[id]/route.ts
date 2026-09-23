import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { approveEventWatchCandidate, rejectEventWatchCandidate } from '@/lib/eventWatch';

const reviewSchema = z.object({ action: z.enum(['approve', 'reject']) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  try {
    const { id } = await params;
    const { action } = reviewSchema.parse(await request.json());
    if (action === 'approve') {
      const event = await approveEventWatchCandidate(id, authResult.data.userId);
      return NextResponse.json({ success: true, event });
    }
    await rejectEventWatchCandidate(id, authResult.data.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid review action' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Review failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
