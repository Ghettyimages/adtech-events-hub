import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { z } from 'zod';

// Schema for updating user roles
const updateUserSchema = z.object({
  email: z.string().email(),
  isOrganizer: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
});

/**
 * GET /api/admin/users
 * List users with their roles (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    const where: any = {};
    if (query) {
      where.OR = [
        { email: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          isOrganizer: true,
          createdAt: true,
          speakerProfile: {
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        isOrganizer: u.isOrganizer,
        createdAt: u.createdAt,
        hasSpeakerProfile: !!u.speakerProfile,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users
 * Update user roles (admin only)
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const body = await request.json();
    const validatedData = updateUserSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Prevent removing own admin access
    if (user.id === authResult.data.userId && validatedData.isAdmin === false) {
      return NextResponse.json(
        { error: 'Cannot remove your own admin access' },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (validatedData.isOrganizer !== undefined) {
      updateData.isOrganizer = validatedData.isOrganizer;
    }
    if (validatedData.isAdmin !== undefined) {
      updateData.isAdmin = validatedData.isAdmin;
    }

    const updatedUser = await prisma.user.update({
      where: { email: validatedData.email },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        isAdmin: true,
        isOrganizer: true,
      },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
