import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { ensureTagExists } from '@/lib/tags-server';
import { normalizeTagName } from '@/lib/tags';
import { z } from 'zod';

// Schema for updating speaker profile
const speakerProfileSchema = z.object({
  displayName: z.string().max(200).optional().nullable(),
  pronouns: z.string().max(50).optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  roleTitle: z.string().max(200).optional().nullable(),
  location: z.string().max(300).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  region: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  bio: z.string().max(5000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  linkedinUrl: z.string().url().optional().nullable().or(z.literal('')),
  websiteUrl: z.string().url().optional().nullable().or(z.literal('')),
  experienceLevel: z.enum(['FIRST_TIME', 'SOME', 'FREQUENT']).optional(),
  talkFormats: z.array(z.string()).optional().nullable(),
  availableVirtual: z.boolean().optional(),
  availableInPerson: z.boolean().optional(),
  noticePeriodDays: z.number().int().min(0).max(365).optional().nullable(),
  willingToTravel: z.boolean().optional(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().max(50).optional().nullable(),
  preferredContact: z.enum(['EMAIL', 'PHONE', 'LINKEDIN']).optional().nullable(),
  contactVisibility: z.enum(['PRIVATE', 'ORGANIZERS_ONLY', 'PUBLIC']).optional(),
  // Topics are tag names (normalized)
  topics: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId } = authResult.data;

    // Try to get existing profile, or auto-create a draft
    let profile = await prisma.speakerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { email: true, companyEmail: true },
        },
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

    // Auto-create draft profile if none exists
    if (!profile) {
      // Get user info to pre-fill some fields
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          company: true,
          title: true,
          location: true,
          linkedInProfile: true,
          companyEmail: true,
          email: true,
        },
      });

      profile = await prisma.speakerProfile.create({
        data: {
          userId,
          displayName: user?.name || null,
          company: user?.company || null,
          roleTitle: user?.title || null,
          location: user?.location || null,
          linkedinUrl: user?.linkedInProfile || null,
          contactEmail: user?.companyEmail || user?.email || null,
          status: 'DRAFT',
        },
        include: {
          user: {
            select: { email: true, companyEmail: true },
          },
          topics: {
            include: {
              tag: true,
            },
          },
          engagements: true,
          credentials: true,
        },
      });
    }

    // Transform topics to array of tag names for easier client consumption
    const topicNames = profile.topics.map((t) => t.tag.name);
    const topicsWithDetails = profile.topics.map((t) => ({
      tagId: t.tagId,
      name: t.tag.name,
      displayName: t.tag.displayName,
      isPrimary: t.isPrimary,
      proficiency: t.proficiency,
    }));

    // Parse talkFormats from JSON string
    let talkFormats: string[] = [];
    if (profile.talkFormats) {
      try {
        talkFormats = JSON.parse(profile.talkFormats);
      } catch {
        talkFormats = [];
      }
    }

    return NextResponse.json({
      ...profile,
      accountEmail: profile.user?.email ?? null,
      talkFormats,
      topicNames,
      topicsWithDetails,
    });
  } catch (error) {
    console.error('Error fetching speaker profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      return authResult.response;
    }

    const { userId } = authResult.data;

    const body = await request.json();
    const validatedData = speakerProfileSchema.parse(body);

    // Process URLs - convert empty strings to null
    const linkedinUrl = validatedData.linkedinUrl?.trim() || null;
    const websiteUrl = validatedData.websiteUrl?.trim() || null;
    const contactEmail = validatedData.contactEmail?.trim() || null;

    // Convert talkFormats to JSON string
    const talkFormats = validatedData.talkFormats
      ? JSON.stringify(validatedData.talkFormats)
      : null;

    // Extract topics for separate handling
    const { topics, ...profileData } = validatedData;

    // Upsert the speaker profile
    const profile = await prisma.speakerProfile.upsert({
      where: { userId },
      update: {
        ...profileData,
        linkedinUrl,
        websiteUrl,
        contactEmail,
        talkFormats,
      },
      create: {
        userId,
        ...profileData,
        linkedinUrl,
        websiteUrl,
        contactEmail,
        talkFormats,
        status: 'DRAFT',
      },
    });

    // Handle topics update if provided
    if (topics !== undefined) {
      // Normalize topic names
      const normalizedTopics = topics.map((t) => normalizeTagName(t));

      // Ensure all tags exist and get their IDs
      const tagPromises = normalizedTopics.map((name) => ensureTagExists(name));
      const tags = await Promise.all(tagPromises);

      // Get current topic associations
      const currentTopics = await prisma.speakerProfileTopic.findMany({
        where: { speakerProfileId: profile.id },
        select: { tagId: true },
      });
      const currentTagIds = new Set(currentTopics.map((t) => t.tagId));
      const newTagIds = new Set(tags.map((t) => t.id));

      // Delete topics that are no longer in the list
      const toDelete = [...currentTagIds].filter((id) => !newTagIds.has(id));
      if (toDelete.length > 0) {
        await prisma.speakerProfileTopic.deleteMany({
          where: {
            speakerProfileId: profile.id,
            tagId: { in: toDelete },
          },
        });
      }

      // Create new topic associations
      const toCreate = tags.filter((t) => !currentTagIds.has(t.id));
      if (toCreate.length > 0) {
        await prisma.speakerProfileTopic.createMany({
          data: toCreate.map((tag) => ({
            speakerProfileId: profile.id,
            tagId: tag.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Fetch updated profile with relations
    const updatedProfile = await prisma.speakerProfile.findUnique({
      where: { id: profile.id },
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

    if (!updatedProfile) {
      return NextResponse.json(
        { error: 'Failed to fetch updated profile' },
        { status: 500 }
      );
    }

    // Transform for response
    const topicNames = updatedProfile.topics.map((t) => t.tag.name);
    const topicsWithDetails = updatedProfile.topics.map((t) => ({
      tagId: t.tagId,
      name: t.tag.name,
      displayName: t.tag.displayName,
      isPrimary: t.isPrimary,
      proficiency: t.proficiency,
    }));

    let parsedTalkFormats: string[] = [];
    if (updatedProfile.talkFormats) {
      try {
        parsedTalkFormats = JSON.parse(updatedProfile.talkFormats);
      } catch {
        parsedTalkFormats = [];
      }
    }

    return NextResponse.json({
      ...updatedProfile,
      talkFormats: parsedTalkFormats,
      topicNames,
      topicsWithDetails,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Error updating speaker profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
