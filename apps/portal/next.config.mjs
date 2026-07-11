/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rademics/ui'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
