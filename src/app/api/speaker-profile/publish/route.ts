import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

// Required fields for publishing a speaker profile
const REQUIRED_FIELDS_FOR_PUBLISH = [
  'bio',
] as const;

const MIN_TOPICS_FOR_PUBLISH = 1;

export async function POST() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId } = authResult.data;

    // Get the profile with topics
    const profile = await prisma.speakerProfile.findUnique({
      where: { userId },
      include: {
        topics: true,
        user: {
          select: { name: true },
        },
      },
    });

    if (!profile) {
      return NextResponse.json(
        { error: 'Speaker profile not found. Please create a profile first.' },
        { status: 404 }
      );
    }

    // Validate required fields
    const missingFields: string[] = [];

    // Check display name or user name
    if (!profile.displayName && !profile.user.name) {
      missingFields.push('displayName (or set your account name)');
    }

    // Check required fields
    for (const field of REQUIRED_FIELDS_FOR_PUBLISH) {
      if (!profile[field] || (typeof profile[field] === 'string' && profile[field].trim() === '')) {
        missingFields.push(field);
      }
    }

    // Check minimum topics
    if (profile.topics.length < MIN_TOPICS_FOR_PUBLISH) {
      missingFields.push(`at least ${MIN_TOPICS_FOR_PUBLISH} topic(s)`);
    }

    // If preferred contact is phone, require contact phone
    if (profile.preferredContact === 'PHONE' && !profile.contactPhone?.trim()) {
      missingFields.push('contact phone (required when phone is preferred contact)');
    }

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot publish profile. Missing required fields.',
          missingFields,
        },
        { status: 400 }
      );
    }

    // Update status to PUBLISHED
    const updatedProfile = await prisma.speakerProfile.update({
      where: { id: profile.id },
      data: { status: 'PUBLISHED' },
      include: {
        topics: {
          include: {
            tag: true,
          },
        },
        engagements: {
          orderBy: { eventDate: 'desc' },
        },
        credentials: {
          orderBy: { issuedAt: 'desc' },
        },
      },
    });

    // Transform for response
    const topicNames = updatedProfile.topics.map((t) => t.tag.name);
    const topicsWithDetails = updatedProfile.topics.map((t) => ({
      tagId: t.tagId,
      name: t.tag.name,
      displayName: t.tag.displayName,
      isPrimary: t.isPrimary,
      proficiency: t.proficiency,
    }));

    let talkFormats: string[] = [];
    if (updatedProfile.talkFormats) {
      try {
        talkFormats = JSON.parse(updatedProfile.talkFormats);
      } catch {
        talkFormats = [];
      }
    }

    return NextResponse.json({
      message: 'Profile published successfully!',
      profile: {
        ...updatedProfile,
        talkFormats,
        topicNames,
        topicsWithDetails,
      },
    });
  } catch (error) {
    console.error('Error publishing speaker profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Also allow unpublishing (setting back to draft)
export async function DELETE() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId } = authResult.data;

    const profile = await prisma.speakerProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return NextResponse.json(
        { error: 'Speaker profile not found.' },
        { status: 404 }
      );
    }

    // Update status to DRAFT
    const updatedProfile = await prisma.speakerProfile.update({
      where: { id: profile.id },
      data: { status: 'DRAFT' },
    });

    return NextResponse.json({
      message: 'Profile unpublished. It is now a draft.',
      profile: updatedProfile,
    });
  } catch (error) {
    console.error('Error unpublishing speaker profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
