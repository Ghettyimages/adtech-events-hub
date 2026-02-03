/**
 * Script to make a user an event organizer (can access speaker directory)
 * Usage: npx tsx scripts/make-organizer.ts <email>
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Load environment variables
if (existsSync(resolve(process.cwd(), '.env.local'))) {
  config({ path: resolve(process.cwd(), '.env.local'), override: true });
}
if (existsSync(resolve(process.cwd(), '.env'))) {
  config({ path: resolve(process.cwd(), '.env') });
}

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function makeOrganizer(email: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.error(`❌ User with email "${email}" not found`);
      process.exit(1);
    }

    if (user.isOrganizer) {
      console.log(`✅ User "${email}" is already an organizer`);
      return;
    }

    await prisma.user.update({
      where: { email },
      data: { isOrganizer: true },
    });

    console.log(`✅ Successfully made "${email}" an event organizer`);
    console.log('   They can now access the speaker directory at /speakers');
  } catch (error: any) {
    console.error('❌ Error making user organizer:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: npx tsx scripts/make-organizer.ts <email>');
  process.exit(1);
}

makeOrganizer(email);
