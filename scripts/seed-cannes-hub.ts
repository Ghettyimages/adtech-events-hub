/**
 * Seed Cannes Lions 2026 hub and sample hosts.
 * Run: npx tsx scripts/seed-cannes-hub.ts
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

if (existsSync(resolve(process.cwd(), '.env'))) {
  config({ path: resolve(process.cwd(), '.env') });
}
if (existsSync(resolve(process.cwd(), '.env.local'))) {
  config({ path: resolve(process.cwd(), '.env.local'), override: true });
}

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const CANNES_THEME = JSON.stringify({
  accent: '#C9A227',
  heroGradient: 'linear-gradient(135deg, #0B2A66 0%, #1a4a8a 50%, #C9A227 100%)',
  surface: '#F5F0E8',
  label: 'Cannes',
});

const HOSTS = [
  {
    slug: 'unplugged-collective',
    name: 'Unplugged Collective',
    featured: true,
    sortOrder: 1,
    sourceAlias: 'Unplugged Collective',
    description: 'Networking and publisher-focused activations at Cannes.',
  },
  {
    slug: 'iab',
    name: 'IAB',
    featured: true,
    sortOrder: 2,
    sourceAlias: 'IAB',
    description: 'Industry panels and programming from the IAB.',
  },
  {
    slug: 'yahoo',
    name: 'Yahoo',
    featured: true,
    sortOrder: 3,
    sourceAlias: 'Yahoo',
    description: 'Yahoo-hosted sessions and hospitality at the festival.',
  },
  {
    slug: 'primis',
    name: 'Primis',
    featured: true,
    sortOrder: 4,
    sourceAlias: 'Primis',
    description: 'Primis events and meetups during Cannes Lions.',
  },
  {
    slug: 'dan-ads',
    name: 'Dan Ads',
    featured: true,
    sortOrder: 5,
    sourceAlias: 'Dan Ads',
    description: 'Dan Ads programming and networking at Cannes.',
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const hub = await prisma.eventHub.upsert({
    where: { slug: 'cannes-2026' },
    create: {
      slug: 'cannes-2026',
      name: 'Cannes Lions 2026',
      tagline: 'Side events, hosts, and activations during the festival',
      description:
        'Discover hundreds of side events during Cannes Lions — hosted by agencies, platforms, and industry groups.',
      start: new Date('2026-06-16T00:00:00.000Z'),
      end: new Date('2026-06-20T23:59:59.000Z'),
      timezone: 'Europe/Paris',
      location: 'Cannes, France',
      status: 'UPCOMING',
      theme: CANNES_THEME,
      sortOrder: 0,
    },
    update: {
      name: 'Cannes Lions 2026',
      status: 'UPCOMING',
      theme: CANNES_THEME,
    },
  });

  console.log(`Hub: ${hub.slug} (${hub.id})`);

  for (const host of HOSTS) {
    const created = await prisma.hubHost.upsert({
      where: {
        hubId_slug: { hubId: hub.id, slug: host.slug },
      },
      create: {
        hubId: hub.id,
        ...host,
      },
      update: {
        name: host.name,
        featured: host.featured,
        sortOrder: host.sortOrder,
        sourceAlias: host.sourceAlias,
        description: host.description,
      },
    });
    console.log(`  Host: ${created.slug}`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
