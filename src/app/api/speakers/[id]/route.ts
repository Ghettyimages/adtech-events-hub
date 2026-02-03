import { NextRequest, NextResponse } from 'next/server';
import { requireOrganizerOrAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require organizer or admin access
    const authResult = await requireOrganizerOrAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { id } = await params;

    // Fetch the speaker profile with all related data
    const speaker = await prisma.speakerProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        topics: {
          include: {
            tag: {
              select: {
                id: true,
                name: true,
                displayName: true,
                color: true,
                description: true,
              },
            },
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

    if (!speaker) {
      return NextResponse.json(
        { error: 'Speaker not found' },
        { status: 404 }
      );
    }

    // Only show published profiles in the directory
    if (speaker.status !== 'PUBLISHED') {
      return NextResponse.json(
        { error: 'Speaker profile is not published' },
        { status: 404 }
      );
    }

    // Handle contact visibility
    let contactInfo: {
      contactEmail?: string | null;
      contactPhone?: string | null;
      preferredContact?: string | null;
    } = {};

    // Since viewer is organizer/admin:
    // - PRIVATE: don't show contact info
    // - ORGANIZERS_ONLY or PUBLIC: show contact info
    if (speaker.contactVisibility !== 'PRIVATE') {
      contactInfo = {
        contactEmail: speaker.contactEmail,
        contactPhone: speaker.contactPhone,
        preferredContact: speaker.preferredContact,
      };
    }

    // Parse talkFormats
    let talkFormats: string[] = [];
    if (speaker.talkFormats) {
      try {
        talkFormats = JSON.parse(speaker.talkFormats);
      } catch {
        talkFormats = [];
      }
    }

    // Transform topics
    const topics = speaker.topics.map((t) => ({
      tagId: t.tagId,
      name: t.tag.name,
      displayName: t.tag.displayName,
      color: t.tag.color,
      description: t.tag.description,
      isPrimary: t.isPrimary,
      proficiency: t.proficiency,
    }));

    // Transform engagements
    const engagements = speaker.engagements.map((e) => ({
      id: e.id,
      eventName: e.eventName,
      talkTitle: e.talkTitle,
      eventDate: e.eventDate,
      eventUrl: e.eventUrl,
      location: e.location,
      role: e.role,
      audienceSize: e.audienceSize,
      videoUrl: e.videoUrl,
      slidesUrl: e.slidesUrl,
      notes: e.notes,
    }));

    // Transform credentials
    const credentials = speaker.credentials.map((c) => ({
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      credentialUrl: c.credentialUrl,
    }));

    return NextResponse.json({
      id: speaker.id,
      userId: speaker.userId,
      displayName: speaker.displayName || speaker.user.name,
      pronouns: speaker.pronouns,
      company: speaker.company,
      roleTitle: speaker.roleTitle,
      location: speaker.location,
      country: speaker.country,
      region: speaker.region,
      city: speaker.city,
      timezone: speaker.timezone,
      bio: speaker.bio,
      notes: speaker.notes,
      linkedinUrl: speaker.linkedinUrl,
      websiteUrl: speaker.websiteUrl,
      experienceLevel: speaker.experienceLevel,
      talkFormats,
      availableVirtual: speaker.availableVirtual,
      availableInPerson: speaker.availableInPerson,
      noticePeriodDays: speaker.noticePeriodDays,
      willingToTravel: speaker.willingToTravel,
      contactVisibility: speaker.contactVisibility,
      ...contactInfo,
      topics,
      engagements,
      credentials,
      createdAt: speaker.createdAt,
      updatedAt: speaker.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching speaker:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
