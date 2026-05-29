import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createEventSchema } from '@/lib/validation';
import { mainCalendarEventWhere } from '@/lib/hubs';
import { eventsListCacheHeaders } from '@/lib/api-cache';
import { normalizeEventForWrite, temporalFieldsForPrisma } from '@/lib/eventTemporal';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const q = searchParams.get('q')?.trim();
    const tags = searchParams.get('tags');
    const country = searchParams.get('country');
    const region = searchParams.get('region');
    const city = searchParams.get('city');
    const source = searchParams.get('source');
    const sort = searchParams.get('sort') || 'date';
    const includeHubEvents = searchParams.get('includeHubEvents') === 'true';

    const session = await auth();
    const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin === true;

    const baseWhere: any =
      includeHubEvents && isAdmin
        ? { status: status || 'PUBLISHED' }
        : mainCalendarEventWhere(status || 'PUBLISHED');

    // Text search: title, description, location (case-insensitive)
    if (q) {
      baseWhere.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Add location filtering
    if (country) {
      baseWhere.country = country;
    }
    if (region) {
      baseWhere.region = region;
    }
    if (city) {
      baseWhere.city = {
        contains: city,
        mode: 'insensitive',
      };
    }
    if (source) {
      baseWhere.source = source;
    }

    // Add tag filtering (JSON array string contains any of the specified tags)
    let where: any = baseWhere;
    if (tags) {
      const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagArray.length > 0) {
        // Since tags is stored as JSON string, we check if the JSON string contains any of the tag names
        // Combine base filters with tag filter using AND
        where = {
          AND: [
            baseWhere,
            {
              OR: tagArray.map((tag) => ({
                tags: {
                  contains: `"${tag}"`, // Check if JSON array contains the tag as a string (e.g., "tag1" in ["tag1","tag2"])
                },
              })),
            },
          ],
        };
      }
    }

    // Build orderBy clause
    let orderBy: any;
    switch (sort) {
      case 'title':
        orderBy = { title: 'asc' };
        break;
      case 'location':
        orderBy = [
          { country: 'asc' },
          { region: 'asc' },
          { city: 'asc' },
        ];
        break;
      case 'date':
      default:
        orderBy = { start: 'asc' };
        break;
    }

    const events = await prisma.event.findMany({
      where,
      orderBy,
      ...(isAdmin
        ? {
            include: {
              submitter: {
                select: { name: true, email: true },
              },
            },
          }
        : {}),
    });

    return NextResponse.json(
      { events },
      {
        headers: eventsListCacheHeaders({ status, isAdmin }),
      }
    );
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate input
    const validatedData = createEventSchema.parse(body);

    let temporal;
    try {
      temporal = normalizeEventForWrite({
        temporalKind: validatedData.temporalKind,
        start: validatedData.start,
        end: validatedData.end,
        timezone: validatedData.timezone,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Invalid date format';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Create event with PENDING status
    const event = await prisma.event.create({
      data: {
        title: validatedData.title,
        description: validatedData.description || null,
        url: validatedData.url || null,
        location: validatedData.location || null,
        ...temporalFieldsForPrisma(temporal),
        source: validatedData.source || null,
        tags: validatedData.tags && validatedData.tags.length > 0 
          ? JSON.stringify(validatedData.tags) 
          : null,
        country: validatedData.country || null,
        region: validatedData.region || null,
        city: validatedData.city || null,
        status: 'PENDING',
        submittedBy: session.user.id,
      },
    });

    // Note: If event is created as PUBLISHED, we'd mark users as pending here
    // But since it's PENDING, we'll handle it when admin approves

    return NextResponse.json({ event }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating event:', error);
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
