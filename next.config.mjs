/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Disable Turbopack for build to avoid bundling issues with Node.js modules
    turbo: false,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize pg and related packages on server to avoid bundling Node.js built-in modules
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
    return config;
  },
};

export default nextConfig;
