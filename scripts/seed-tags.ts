/**
 * Seed script to migrate PREDEFINED_TAGS from tagExtractor.ts to database
 * Run with: npx tsx scripts/seed-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import { PREDEFINED_TAGS } from '../src/lib/extractor/tagExtractor';
import { normalizeTagName } from '../src/lib/tags';

const prisma = new PrismaClient();

async function seedTags() {
  try {
    console.log('🌱 Starting tag seed...');
    
    let created = 0;
    let skipped = 0;

    for (const tagName of PREDEFINED_TAGS) {
      const normalized = normalizeTagName(tagName);
      
      try {
        // Check if tag already exists
        const existing = await prisma.tag.findUnique({
          where: { name: normalized },
        });

        if (existing) {
          console.log(`⏭️  Tag "${normalized}" already exists, skipping...`);
          skipped++;
          continue;
        }

        // Create tag
        await prisma.tag.create({
          data: {
            name: normalized,
            displayName: tagName.charAt(0).toUpperCase() + tagName.slice(1),
            usageCount: 0,
          },
        });

        console.log(`✅ Created tag: "${normalized}"`);
        created++;
      } catch (error: any) {
        console.error(`❌ Error creating tag "${normalized}":`, error.message);
      }
    }

    console.log(`\n🎉 Tag seeding complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${PREDEFINED_TAGS.length}`);
  } catch (error: any) {
    console.error('❌ Failed to seed tags:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed
seedTags();

