import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { z } from 'zod';

// Validation schema
const signupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  company: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  linkedInProfile: z.string().url('Invalid LinkedIn URL').optional().or(z.literal('')),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

// LinkedIn URL validation helper
function isValidLinkedInUrl(url: string): boolean {
  if (!url) return true; // Empty is valid (optional field)
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'www.linkedin.com' || urlObj.hostname === 'linkedin.com';
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validationResult = signupSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { name, email, password, company, title, location, linkedInProfile } = validationResult.data;

    // Validate LinkedIn URL if provided (skip if empty string)
    const linkedInUrl = linkedInProfile?.trim();
    if (linkedInUrl && linkedInUrl !== '' && !isValidLinkedInUrl(linkedInUrl)) {
      return NextResponse.json(
        { error: 'Invalid LinkedIn URL. Must be a valid linkedin.com URL.' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        company: company?.trim() || null,
        title: title?.trim() || null,
        location: location?.trim() || null,
        linkedInProfile: linkedInUrl || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        title: true,
        location: true,
        linkedInProfile: true,
      },
    });

    return NextResponse.json(
      { 
        message: 'Account created successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Signup error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'An error occurred while creating your account';
    let statusCode = 500;
    
    if (error?.code === 'P2002') {
      // Prisma unique constraint violation
      errorMessage = 'User with this email already exists';
      statusCode = 400;
    } else if (error?.message?.includes('PrismaClient')) {
      errorMessage = 'Database connection error. Please try again later.';
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { details: error?.message, stack: error?.stack })
      },
      { status: statusCode }
    );
  }
}

