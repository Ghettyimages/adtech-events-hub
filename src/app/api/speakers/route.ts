import { NextRequest, NextResponse } from 'next/server';
import { requireOrganizerOrAdmin } from '@/lib/auth-helpers';
import { prisma } from '@/lib/db';
import { normalizeTagName } from '@/lib/tags';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    // Require organizer or admin access
    const authResult = await requireOrganizerOrAdmin();
    if (!authResult.success) {
      return authResult.response;
    }

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const q = searchParams.get('q')?.trim() || '';
    const topicsParam = searchParams.get('topics') || '';
    const country = searchParams.get('country')?.trim() || '';
    const region = searchParams.get('region')?.trim() || '';
    const city = searchParams.get('city')?.trim() || '';
    const experienceLevel = searchParams.get('experienceLevel') || '';
    const availableVirtual = searchParams.get('availableVirtual');
    const availableInPerson = searchParams.get('availableInPerson');
    const noticePeriodMax = searchParams.get('noticePeriodMax');
    const sort = searchParams.get('sort') || 'recent';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
    );

    // Parse topics (comma-separated, normalized)
    const topics = topicsParam
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => normalizeTagName(t));

    // Build where clause
    const where: any = {
      status: 'PUBLISHED',
    };

    // Free-text search (name, company, role, bio)
    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { roleTitle: { contains: q, mode: 'insensitive' } },
        { bio: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Location filters
    if (country) {
      where.country = { contains: country, mode: 'insensitive' };
    }
    if (region) {
      where.region = { contains: region, mode: 'insensitive' };
    }
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }

    // Experience level filter
    if (experienceLevel && ['FIRST_TIME', 'SOME', 'FREQUENT'].includes(experienceLevel)) {
      where.experienceLevel = experienceLevel;
    }

    // Availability filters
    if (availableVirtual === 'true') {
      where.availableVirtual = true;
    }
    if (availableInPerson === 'true') {
      where.availableInPerson = true;
    }

    // Notice period filter (max days)
    if (noticePeriodMax) {
      const maxDays = parseInt(noticePeriodMax, 10);
      if (!isNaN(maxDays) && maxDays >= 0) {
        where.OR = [
          ...(where.OR || []),
          { noticePeriodDays: { lte: maxDays } },
          { noticePeriodDays: null }, // Include those who haven't specified (assume flexible)
        ];
      }
    }

    // Topics filter - speakers who have ANY of the specified topics
    if (topics.length > 0) {
      where.topics = {
        some: {
          tag: {
            name: { in: topics },
          },
        },
      };
    }

    // Build orderBy
    let orderBy: any;
    switch (sort) {
      case 'name':
        orderBy = [
          { displayName: 'asc' },
          { user: { name: 'asc' } },
        ];
        break;
      case 'experience':
        // Order: FREQUENT > SOME > FIRST_TIME
        orderBy = [
          { experienceLevel: 'desc' },
          { updatedAt: 'desc' },
        ];
        break;
      case 'lastUpdated':
        orderBy = { updatedAt: 'desc' };
        break;
      case 'recent':
      default:
        orderBy = { createdAt: 'desc' };
        break;
    }

    // Execute count and query in parallel
    const [total, speakers] = await Promise.all([
      prisma.speakerProfile.count({ where }),
      prisma.speakerProfile.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
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
                  name: true,
                  displayName: true,
                  color: true,
                },
              },
            },
          },
          _count: {
            select: {
              engagements: true,
              credentials: true,
            },
          },
        },
      }),
    ]);

    // Transform speakers for response
    const transformedSpeakers = speakers.map((speaker) => {
      // Handle contact visibility
      let contactInfo: {
        contactEmail?: string | null;
        contactPhone?: string | null;
        preferredContact?: string | null;
      } = {};

      // Since viewer is organizer/admin, show contact if visibility is ORGANIZERS_ONLY or PUBLIC
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

      return {
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
        bio: speaker.bio,
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
        topics: speaker.topics.map((t) => ({
          name: t.tag.name,
          displayName: t.tag.displayName,
          color: t.tag.color,
          isPrimary: t.isPrimary,
        })),
        engagementsCount: speaker._count.engagements,
        credentialsCount: speaker._count.credentials,
        createdAt: speaker.createdAt,
        updatedAt: speaker.updatedAt,
      };
    });

    return NextResponse.json({
      speakers: transformedSpeakers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasMore: page * pageSize < total,
      },
    });
  } catch (error) {
    console.error('Error fetching speakers:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
