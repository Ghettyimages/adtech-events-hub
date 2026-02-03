/**
 * Auth helper functions for API routes
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export interface AuthResult {
  userId: string;
  isAdmin: boolean;
  isOrganizer: boolean;
}

/**
 * Require authentication and return user info
 * Returns 401 if not authenticated
 */
export async function requireAuth(): Promise<
  { success: true; data: AuthResult } | { success: false; response: NextResponse }
> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  // Fetch fresh isAdmin/isOrganizer from DB (session might be stale)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true, isOrganizer: true },
  });

  return {
    success: true,
    data: {
      userId: session.user.id,
      isAdmin: user?.isAdmin || false,
      isOrganizer: user?.isOrganizer || false,
    },
  };
}

/**
 * Require organizer or admin access
 * Returns 401 if not authenticated, 403 if not authorized
 */
export async function requireOrganizerOrAdmin(): Promise<
  { success: true; data: AuthResult } | { success: false; response: NextResponse }
> {
  const authResult = await requireAuth();

  if (!authResult.success) {
    return authResult;
  }

  const { isAdmin, isOrganizer } = authResult.data;

  if (!isAdmin && !isOrganizer) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return authResult;
}

/**
 * Require admin access
 * Returns 401 if not authenticated, 403 if not admin
 */
export async function requireAdmin(): Promise<
  { success: true; data: AuthResult } | { success: false; response: NextResponse }
> {
  const authResult = await requireAuth();

  if (!authResult.success) {
    return authResult;
  }

  if (!authResult.data.isAdmin) {
    return {
      success: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return authResult;
}
