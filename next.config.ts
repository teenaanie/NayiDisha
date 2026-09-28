import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres'],
  eslint: { ignoreDuringBuilds: true },
  // Resume uploads (4 MB cap, under Vercel's 4.5 MB request limit) and
  // recorded practice answers travel through server actions.
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};

export default nextConfig;
