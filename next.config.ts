import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	output: 'standalone',
	poweredByHeader: false,
	reactStrictMode: true,
	serverExternalPackages: ['@prisma/client', 'playwright', 'playwright-core'],
};

export default nextConfig;
