import { handlers } from '@/lib/auth';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    return await handlers.GET(request);
  } catch (error) {
    console.error('NextAuth GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Authentication error', message: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handlers.POST(request);
  } catch (error) {
    console.error('NextAuth POST error:', error);
    return new Response(
      JSON.stringify({ error: 'Authentication error', message: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

