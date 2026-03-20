import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	output: 'standalone',
	poweredByHeader: false,
	reactStrictMode: true,
	serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
