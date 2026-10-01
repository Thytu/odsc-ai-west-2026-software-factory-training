import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@eventdesk/data'],
  async rewrites() {
    return [{ source: '/backend/:path*', destination: `${process.env.EVENTDESK_API_ORIGIN ?? 'http://127.0.0.1:4000'}/:path*` }];
  },
};

export default nextConfig;
