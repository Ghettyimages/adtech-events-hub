import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(request: NextRequest) {
  try {
    // TODO: Add authentication before production
    // const authHeader = request.headers.get('authorization');
    // if (authHeader !== `Bearer ${process.env.REVALIDATE_SECRET}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    // Revalidate the home page and API routes
    revalidatePath('/');
    revalidatePath('/api/events');
    revalidatePath('/api/feed');

    return NextResponse.json({ 
      revalidated: true, 
      timestamp: new Date().toISOString() 
    });
  } catch (error: any) {
    console.error('Error revalidating:', error);
    return NextResponse.json({ error: 'Failed to revalidate' }, { status: 500 });
  }
}
