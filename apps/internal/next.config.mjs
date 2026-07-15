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
// HTTPS-only hardening (HSTS + upgrade-insecure-requests) is correct behind TLS but
// breaks a plain-HTTP-by-IP deployment. Gate it on PUBLIC_HTTPS (default on; set
// PUBLIC_HTTPS=false for the pre-domain IP:port phase).
const httpsEnabled = process.env.PUBLIC_HTTPS !== 'false';

/**
 * Content-Security-Policy + security headers (Spec §10). Next.js needs inline styles
 * (Tailwind) and inline bootstrap scripts; dev additionally needs 'unsafe-eval' for
 * React Fast Refresh. Everything else is locked to 'self' + the API origin.
 */
function contentSecurityPolicy() {
  const [apiHttp, apiWs] = apiOrigins();
  const turnstile = 'https://challenges.cloudflare.com';
  const scriptSrc = isProd
    ? `'self' 'unsafe-inline' ${turnstile}`
    : `'self' 'unsafe-inline' 'unsafe-eval' ${turnstile}`;
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
    `connect-src 'self' ${apiHttp} ${apiWs} ${turnstile}`,
    `frame-src ${turnstile}`, // Turnstile's own challenge widget (Spec §10 CAPTCHA)
    ...(isProd && httpsEnabled ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(httpsEnabled
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @rademics/ui ships as source (RSC-friendly); transpile it here (Spec §9 shared UI).
  transpilePackages: ['@rademics/ui'],
  // Linting is a separate CI step; don't fail production builds on it.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
