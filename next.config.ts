import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
