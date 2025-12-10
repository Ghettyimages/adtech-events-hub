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
