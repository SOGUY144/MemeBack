import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The GIF encoder and the Pixi renderer are browser-only; nothing here should
  // ever be pulled into a server bundle.
  serverExternalPackages: ['@prisma/client', '@anthropic-ai/sdk'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
