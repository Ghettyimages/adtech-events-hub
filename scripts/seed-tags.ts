/**
 * Seed initial tags with keywords for automatic tag extraction
 * This script populates the database with the 10 predefined tags and their keywords
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create a Pool for PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Normalize tag name function (copied from lib/tags.ts for script use)
function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

// Initial tags with keywords (from current TAG_KEYWORDS in tagExtractor.ts)
const INITIAL_TAGS = [
  {
    name: 'adtech',
    displayName: 'AdTech',
    keywords: ['adtech', 'ad tech', 'advertising technology', 'advertising tech'],
    description: 'Advertising technology events',
  },
  {
    name: 'publishers',
    displayName: 'Publishers',
    keywords: ['publisher', 'publishing', 'media publisher', 'content publisher'],
    description: 'Publishing and media events',
  },
  {
    name: 'programmatic',
    displayName: 'Programmatic',
    keywords: ['programmatic', 'programmatic advertising', 'rtb', 'real-time bidding'],
    description: 'Programmatic advertising events',
  },
  {
    name: 'ctv',
    displayName: 'CTV',
    keywords: ['ctv', 'connected tv', 'streaming tv', 'ott', 'over-the-top'],
    description: 'Connected TV and streaming events',
  },
  {
    name: 'data',
    displayName: 'Data',
    keywords: ['data', 'data science', 'data analytics', 'big data', 'data platform'],
    description: 'Data and analytics events',
  },
  {
    name: 'privacy',
    displayName: 'Privacy',
    keywords: ['privacy', 'gdpr', 'ccpa', 'data privacy', 'consumer privacy'],
    description: 'Privacy and compliance events',
  },
  {
    name: 'measurement',
    displayName: 'Measurement',
    keywords: ['measurement', 'attribution', 'analytics', 'metrics', 'reporting'],
    description: 'Measurement and attribution events',
  },
  {
    name: 'marketing',
    displayName: 'Marketing',
    keywords: ['marketing', 'digital marketing', 'brand marketing', 'performance marketing'],
    description: 'Marketing events',
  },
  {
    name: 'mobile',
    displayName: 'Mobile',
    keywords: ['mobile', 'mobile advertising', 'app marketing', 'mobile marketing'],
    description: 'Mobile advertising events',
  },
  {
    name: 'video',
    displayName: 'Video',
    keywords: ['video', 'video advertising', 'video marketing', 'streaming video'],
    description: 'Video advertising events',
  },
];

async function seedTags() {
  try {
    console.log('🌱 Seeding tags with keywords...\n');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const tagData of INITIAL_TAGS) {
      // Normalize tag name
      const normalizedName = normalizeTagName(tagData.name);
      
      // Convert keywords array to JSON string
      const keywordsJson = JSON.stringify(tagData.keywords);

      try {
        // Try to create the tag
        await prisma.tag.create({
          data: {
            name: normalizedName,
            displayName: tagData.displayName,
            description: tagData.description,
            keywords: keywordsJson,
            usageCount: 0,
          },
        });
        console.log(`✅ Created tag: ${normalizedName}`);
        created++;
      } catch (error: any) {
        // If unique constraint error (P2002), tag already exists - update it
        if (error.code === 'P2002' || error.message?.includes('Unique constraint') || error.message?.includes('already exists')) {
          try {
            await prisma.tag.updateMany({
              where: { name: normalizedName },
              data: {
                keywords: keywordsJson,
                displayName: tagData.displayName,
                description: tagData.description,
              },
            });
            console.log(`✅ Updated existing tag: ${normalizedName}`);
            updated++;
          } catch (updateError: any) {
            console.error(`❌ Error updating tag ${normalizedName}:`, updateError.message);
          }
        } else {
          console.error(`❌ Error processing tag ${normalizedName}:`, error.message || error);
        }
      }
    }

    console.log(`\n🎉 Tag seeding complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
  } catch (error: any) {
    console.error('❌ Failed to seed tags:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seedTags();
