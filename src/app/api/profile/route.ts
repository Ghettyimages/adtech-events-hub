import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const profileSchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  location: z.string().optional(),
  consentEmail: z.boolean().optional(),
  consentCalendar: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        title: true,
        companyEmail: true,
        location: true,
        consentEmail: true,
        consentCalendar: true,
        feedToken: true,
        termsAcceptedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if profile is complete
    // Profile is complete if all required fields have values: name, company, title, companyEmail, location
    const isProfileComplete = !!(
      user.name &&
      user.company &&
      user.title &&
      user.companyEmail &&
      user.location
    );

    return NextResponse.json({
      ...user,
      isProfileComplete,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if this is a first-time save (profile incomplete)
    const existingUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        company: true,
        title: true,
        companyEmail: true,
        location: true,
      },
    });

    const isFirstTimeSave = !existingUser || !(
      existingUser.name &&
      existingUser.company &&
      existingUser.title &&
      existingUser.companyEmail &&
      existingUser.location
    );

    // Create schema based on whether it's a first-time save
    const validationSchema = isFirstTimeSave
      ? z.object({
          name: z.string().min(1, 'Name is required'),
          company: z.string().min(1, 'Company is required'),
          title: z.string().min(1, 'Title is required'),
          companyEmail: z.string().email('Valid company email is required').min(1, 'Company email is required'),
          location: z.string().min(1, 'Location is required'),
          consentEmail: z.boolean().optional(),
          consentCalendar: z.boolean().optional(),
        })
      : profileSchema;

    const body = await request.json();
    const validatedData = validationSchema.parse(body);

    // Prepare update data
    const updateData: any = {
      ...validatedData,
    };

    // If consent checkboxes are being set, also set termsAcceptedAt
    if (validatedData.consentEmail !== undefined || validatedData.consentCalendar !== undefined) {
      updateData.termsAcceptedAt = new Date();
    }

    // Handle empty string for companyEmail (convert to null)
    if (updateData.companyEmail === '') {
      updateData.companyEmail = null;
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        title: true,
        companyEmail: true,
        location: true,
        consentEmail: true,
        consentCalendar: true,
        feedToken: true,
        termsAcceptedAt: true,
      },
    });

    // Check if profile is complete
    const isProfileComplete = !!(
      user.name &&
      user.company &&
      user.title &&
      user.companyEmail &&
      user.location
    );

    return NextResponse.json({
      ...user,
      isProfileComplete,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error updating profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

