import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeTagName } from '@/lib/tags';
import { z } from 'zod';

const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(100),
  displayName: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code (e.g., #FF5733)').optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get('sort') || 'name'; // name, usage, created

    let orderBy: any;
    switch (sort) {
      case 'usage':
        orderBy = [
          { usageCount: 'desc' },
          { name: 'asc' },
        ];
        break;
      case 'created':
        orderBy = { createdAt: 'desc' };
        break;
      case 'name':
      default:
        orderBy = { name: 'asc' };
        break;
    }

    const tags = await prisma.tag.findMany({
      orderBy,
    });

    return NextResponse.json({ tags });
  } catch (error: any) {
    console.error('Error fetching tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validatedData = createTagSchema.parse(body);

    // Normalize tag name
    const normalizedName = normalizeTagName(validatedData.name);

    // Check if tag already exists
    const existing = await prisma.tag.findUnique({
      where: { name: normalizedName },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Tag "${normalizedName}" already exists` },
        { status: 400 }
      );
    }

    // Create tag
    const tag = await prisma.tag.create({
      data: {
        name: normalizedName,
        displayName: validatedData.displayName || null,
        description: validatedData.description || null,
        color: validatedData.color || null,
        usageCount: 0,
      },
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating tag:', error);
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}

