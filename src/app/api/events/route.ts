import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/db';
import { createEventSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const tags = searchParams.get('tags');
    const country = searchParams.get('country');
    const region = searchParams.get('region');
    const city = searchParams.get('city');
    const source = searchParams.get('source');
    const sort = searchParams.get('sort') || 'date';

    // Build where clause
    const where: any = {
      status: status || 'PUBLISHED',
    };

    // Add tag filtering (array contains any of the specified tags)
    if (tags) {
      const tagArray = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagArray.length > 0) {
        where.tags = {
          hasSome: tagArray,
        };
      }
    }

    // Add location filtering
    if (country) {
      where.country = country;
    }
    if (region) {
      where.region = region;
    }
    if (city) {
      // Case-insensitive search (SQLite doesn't support mode: 'insensitive', but we can use contains)
      where.city = {
        contains: city,
      };
    }
    if (source) {
      where.source = source;
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
    });

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate input
    const validatedData = createEventSchema.parse(body);

    // Convert datetime-local strings to ISO format if needed
    const startDate = new Date(validatedData.start);
    const endDate = new Date(validatedData.end);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    if (endDate <= startDate) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
    }

    // Create event with PENDING status
    const event = await prisma.event.create({
      data: {
        title: validatedData.title,
        description: validatedData.description || null,
        url: validatedData.url || null,
        location: validatedData.location || null,
        start: startDate,
        end: endDate,
        timezone: validatedData.timezone || null,
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
