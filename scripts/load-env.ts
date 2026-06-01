/**
 * Load .env then .env.local (override), matching prisma.config.ts.
 * Use this instead of `import 'dotenv/config'` in CLI scripts.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const cwd = process.cwd();

if (existsSync(resolve(cwd, '.env'))) {
  config({ path: resolve(cwd, '.env') });
}
if (existsSync(resolve(cwd, '.env.local'))) {
  config({ path: resolve(cwd, '.env.local'), override: true });
}
