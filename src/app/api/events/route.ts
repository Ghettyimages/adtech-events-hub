import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createEventSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where = status ? { status } : { status: 'PUBLISHED' };

    const events = await prisma.event.findMany({
      where,
      orderBy: { start: 'asc' },
    });

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
        status: 'PENDING',
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
