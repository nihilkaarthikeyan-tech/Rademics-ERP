/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @rademics/ui ships as source (RSC-friendly); transpile it here (Spec §9 shared UI).
  transpilePackages: ['@rademics/ui'],
  // Linting is a separate CI step; don't fail production builds on it.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
