import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeTagName } from '@/lib/tags';
import { z } from 'zod';

const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(100),
  displayName: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code (e.g., #FF5733)').optional().nullable(),
  keywords: z.union([
    z.string(), // JSON string
    z.array(z.string()), // Array of strings
    z.null(),
    z.undefined(),
  ]).optional().nullable(),
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

    // Process keywords: convert array to JSON string if needed, or use string as-is
    let keywordsJson: string | null = null;
    if (validatedData.keywords) {
      if (Array.isArray(validatedData.keywords)) {
        keywordsJson = JSON.stringify(validatedData.keywords);
      } else if (typeof validatedData.keywords === 'string') {
        // If it's already a JSON string, validate it's valid JSON
        try {
          const parsed = JSON.parse(validatedData.keywords);
          if (Array.isArray(parsed)) {
            keywordsJson = validatedData.keywords;
          } else {
            return NextResponse.json(
              { error: 'Keywords must be a JSON array of strings' },
              { status: 400 }
            );
          }
        } catch (e) {
          return NextResponse.json(
            { error: 'Keywords must be a valid JSON array string' },
            { status: 400 }
          );
        }
      }
    }

    // Create tag
    const tag = await prisma.tag.create({
      data: {
        name: normalizedName,
        displayName: validatedData.displayName || null,
        description: validatedData.description || null,
        color: validatedData.color || null,
        keywords: keywordsJson,
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

