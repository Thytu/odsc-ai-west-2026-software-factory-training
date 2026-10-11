import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@eventdesk/data'],
  allowedDevOrigins: ['eventdesk.localhost', '*.eventdesk.localhost'],
  async rewrites() {
    const origin = process.env.EVENTDESK_API_ORIGIN;
    return origin ? [{ source: '/backend/:path*', destination: `${origin}/backend/:path*` }] : [];
  },
};

export default nextConfig;
