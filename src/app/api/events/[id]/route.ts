import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { updateEventSchema, updateEventStatusSchema } from '@/lib/validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const event = await prisma.event.findUnique({
      where: { id },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({ event });
  } catch (error: any) {
    console.error('Error fetching event:', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body;
    
    try {
      body = await request.json();
      console.log('PATCH request received for event:', id);
      console.log('Request body:', JSON.stringify(body, null, 2));
    } catch (parseError: any) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body', details: parseError.message },
        { status: 400 }
      );
    }

    // Check if this is just a status update (backward compatibility)
    if (body.status && Object.keys(body).length === 1) {
      const validatedData = updateEventStatusSchema.parse({ id, status: body.status });
      
      const event = await prisma.event.update({
        where: { id },
        data: { status: validatedData.status },
      });

      return NextResponse.json({ event });
    }

    // Full event update
    let validatedData;
    try {
      validatedData = updateEventSchema.parse(body);
      console.log('Validation passed:', JSON.stringify(validatedData, null, 2));
    } catch (validationError: any) {
      console.error('Validation failed:', validationError);
      if (validationError.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Validation error', details: validationError.errors },
          { status: 400 }
        );
      }
      throw validationError;
    }
    
    const updateData: any = {};
    
    if (validatedData.title !== undefined) updateData.title = validatedData.title;
    // Handle optional fields - accept null, empty string, or undefined
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description === null || validatedData.description === '' 
        ? null 
        : validatedData.description;
    }
    if (validatedData.url !== undefined) {
      // URL can be null, empty string, or a valid URL
      updateData.url = validatedData.url === null || validatedData.url === '' 
        ? null 
        : validatedData.url;
    }
    if (validatedData.location !== undefined) {
      updateData.location = validatedData.location === null || validatedData.location === '' 
        ? null 
        : validatedData.location;
    }
    if (validatedData.timezone !== undefined) {
      updateData.timezone = validatedData.timezone === null || validatedData.timezone === '' 
        ? null 
        : validatedData.timezone;
    }
    if (validatedData.source !== undefined) {
      updateData.source = validatedData.source === null || validatedData.source === '' 
        ? null 
        : validatedData.source;
    }
    if (validatedData.country !== undefined) {
      updateData.country = validatedData.country === null || validatedData.country === '' 
        ? null 
        : validatedData.country;
    }
    if (validatedData.region !== undefined) {
      updateData.region = validatedData.region === null || validatedData.region === '' 
        ? null 
        : validatedData.region;
    }
    if (validatedData.city !== undefined) {
      updateData.city = validatedData.city === null || validatedData.city === '' 
        ? null 
        : validatedData.city;
    }
    if (validatedData.status !== undefined) updateData.status = validatedData.status;
    
    // Handle tags - convert array to JSON string if provided
    if (validatedData.tags !== undefined) {
      if (Array.isArray(validatedData.tags) && validatedData.tags.length > 0) {
        updateData.tags = JSON.stringify(validatedData.tags);
      } else {
        updateData.tags = null;
      }
    }

    // Handle date updates
    if (validatedData.start !== undefined) {
      const startDate = new Date(validatedData.start);
      if (isNaN(startDate.getTime())) {
        return NextResponse.json({ error: 'Invalid start date format' }, { status: 400 });
      }
      updateData.start = startDate;
    }

    if (validatedData.end !== undefined) {
      const endDate = new Date(validatedData.end);
      if (isNaN(endDate.getTime())) {
        return NextResponse.json({ error: 'Invalid end date format' }, { status: 400 });
      }
      updateData.end = endDate;
    }

    // Validate date order if both dates are being updated
    if (updateData.start && updateData.end && updateData.end <= updateData.start) {
      return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
    }

    // If only one date is updated, validate against existing date
    const existingEvent = await prisma.event.findUnique({ where: { id } });
    if (existingEvent) {
      const finalStart = updateData.start || existingEvent.start;
      const finalEnd = updateData.end || existingEvent.end;
      if (finalEnd <= finalStart) {
        return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
      }
    }

    console.log('Update data to be saved:', JSON.stringify(updateData, null, 2));
    
    const event = await prisma.event.update({
      where: { id },
      data: updateData,
    });

    console.log('Event updated successfully:', event.id);
    return NextResponse.json({ event });
  } catch (error: any) {
    console.error('Error updating event:', error);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(
      { 
        error: 'Failed to update event',
        message: error.message || 'Unknown error',
        code: error.code
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.event.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting event:', error);
    
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
