import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeTagName } from '@/lib/tags';
import { z } from 'zod';

const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  keywords: z.union([
    z.string(), // JSON string
    z.array(z.string()), // Array of strings
    z.null(),
    z.undefined(),
  ]).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ tag });
  } catch (error: any) {
    console.error('Error fetching tag:', error);
    return NextResponse.json({ error: 'Failed to fetch tag' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate input
    const validatedData = updateTagSchema.parse(body);

    // Check if tag exists
    const existing = await prisma.tag.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Build update data
    const updateData: any = {};

    // If name is being changed, normalize and check uniqueness
    if (validatedData.name !== undefined) {
      const normalizedName = normalizeTagName(validatedData.name);
      
      // Check if another tag with this name exists
      if (normalizedName !== existing.name) {
        const duplicate = await prisma.tag.findUnique({
          where: { name: normalizedName },
        });

        if (duplicate) {
          return NextResponse.json(
            { error: `Tag "${normalizedName}" already exists` },
            { status: 400 }
          );
        }
      }
      
      updateData.name = normalizedName;
    }

    if (validatedData.displayName !== undefined) {
      updateData.displayName = validatedData.displayName || null;
    }
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description || null;
    }
    if (validatedData.color !== undefined) {
      updateData.color = validatedData.color || null;
    }
    if (validatedData.keywords !== undefined) {
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
      updateData.keywords = keywordsJson;
    }

    // Update tag
    const tag = await prisma.tag.update({
      where: { id },
      data: updateData,
    });

    // If name changed, we might need to update events that reference the old name
    // For now, we'll just update the tag. In a full implementation, you might
    // want to update all events that use the old tag name to use the new one.

    return NextResponse.json({ tag });
  } catch (error: any) {
    console.error('Error updating tag:', error);
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if tag exists
    const tag = await prisma.tag.findUnique({
      where: { id },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Check if tag is in use
    if (tag.usageCount > 0) {
      return NextResponse.json(
        { 
          error: `Cannot delete tag. It is currently used by ${tag.usageCount} event(s).`,
          usageCount: tag.usageCount,
        },
        { status: 400 }
      );
    }

    // Delete tag
    await prisma.tag.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting tag:', error);
    
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}

