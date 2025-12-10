/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Mark pg and related packages as external server-only packages
    serverComponentsExternalPackages: ['pg', 'pg-native', '@prisma/adapter-pg'],
  },
  webpack: (config, { isServer, webpack }) => {
    // Externalize pg and related packages to avoid bundling Node.js built-in modules
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
