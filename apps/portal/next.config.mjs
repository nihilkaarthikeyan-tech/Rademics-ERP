/**
 * Derive the API origin (+ its websocket origin for Socket.IO) from the public API
 * URL so connect-src stays correct across environments (Spec §10 CSP, §12 Socket.IO).
 */
function apiOrigins() {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
  try {
    const u = new URL(raw);
    const http = u.origin;
    const ws = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`;
    return [http, ws];
  } catch {
    return ['http://localhost:4000', 'ws://localhost:4000'];
  }
}

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content-Security-Policy + security headers (Spec §10). The client portal is the
 * externally-exposed surface (§5.5), so the same locked-down policy applies here.
 */
function contentSecurityPolicy() {
  const [apiHttp, apiWs] = apiOrigins();
  const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiHttp} ${apiWs}`,
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@rademics/ui'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
