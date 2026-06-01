import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * In local dev, Windows user-level env vars can shadow .env.local (e.g. a revoked
 * OPENAI_API_KEY). Prefer values from .env.local for API keys used by scraping/LLM.
 */
function applyEnvLocalApiKeyOverrides() {
  const envLocalPath = join(__dirname, '.env.local');
  if (!existsSync(envLocalPath)) return;

  const keysToOverride = new Set(['OPENAI_API_KEY', 'FIRECRAWL_API_KEY', 'LLM_API_KEY']);
  const content = readFileSync(envLocalPath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!keysToOverride.has(key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[key] = value;
  }
}

applyEnvLocalApiKeyOverrides();

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Mark pg and related packages as external server-only packages (moved from experimental in Next.js 16)
  serverExternalPackages: ['pg', 'pg-native', '@prisma/adapter-pg'],
  // Add empty turbopack config to silence warning when webpack config exists
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Externalize pg and related packages to avoid bundling Node.js built-in modules
    // Note: This only applies when webpack is used, not Turbopack
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('pg', 'pg-native');
      } else {
        config.externals = [
          ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
          'pg',
          'pg-native',
        ];
      }
    }
    
    // Ignore pg and related packages on client side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        pg: false,
        'pg-native': false,
        dns: false,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    return config;
  },
};

export default nextConfig;
