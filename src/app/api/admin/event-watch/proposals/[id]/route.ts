import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { reviewEventWatchProposal } from '@/lib/eventWatch';

const reviewSchema = z.object({ action: z.enum(['approve', 'reject']) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  try {
    const { id } = await params;
    const { action } = reviewSchema.parse(await request.json());
    const event = await reviewEventWatchProposal(id, action, authResult.data.userId);
    return NextResponse.json({ success: true, event });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid review action' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Review failed';
    const status = message.includes('changed after the proposal') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
