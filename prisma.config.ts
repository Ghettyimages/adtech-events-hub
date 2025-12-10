// Load .env.local file explicitly for Prisma CLI
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Load .env first (base configuration)
if (existsSync(resolve(process.cwd(), '.env'))) {
  config({ path: resolve(process.cwd(), '.env') });
}

// Load .env.local second (overrides .env, for local development with Vercel Postgres)
if (existsSync(resolve(process.cwd(), '.env.local'))) {
  config({ path: resolve(process.cwd(), '.env.local'), override: true });
}

import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://placeholder',
  },
});

