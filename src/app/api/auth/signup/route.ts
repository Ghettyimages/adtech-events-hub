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

    // Validate LinkedIn URL if provided
    if (linkedInProfile && !isValidLinkedInUrl(linkedInProfile)) {
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
        company: company || null,
        title: title || null,
        location: location || null,
        linkedInProfile: linkedInProfile || null,
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
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'An error occurred while creating your account' },
      { status: 500 }
    );
  }
}

