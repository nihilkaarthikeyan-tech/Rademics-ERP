import { z } from 'zod';

/** Validated environment. Fail fast on boot if misconfigured (Spec §10 — secrets server-side). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  FIELD_ENCRYPTION_KEY: z.string().min(16),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().default('Rademics ERP <no-reply@rademics.local>'),

  INTERNAL_APP_URL: z.string().url().default('http://localhost:3000'),
  PORTAL_APP_URL: z.string().url().default('http://localhost:3001'),
  COMPANY_TIMEZONE: z.string().default('Asia/Kolkata'),

  // Object storage (MinIO / S3-compatible) — Spec §5.6, §12.
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_BUCKET: z.string().default('rademics-files'),
  S3_ACCESS_KEY: z.string().default('rademics'),
  S3_SECRET_KEY: z.string().default('rademics-secret'),
  S3_REGION: z.string().default('us-east-1'),

  // ClamAV virus scanning — Spec §5.6, §12.
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().default(3310),

  SENTRY_DSN: z.string().optional().default(''),
  // Deployed git SHA (Spec §11). Read directly from process.env by instrument.ts,
  // which runs before Nest boots — declared here so it survives validation and shows
  // up in /api/health. Empty => events simply carry no release tag.
  SENTRY_RELEASE: z.string().optional().default(''),

  // Cloudflare Turnstile CAPTCHA (Spec §10 bot protection). Optional: when unset,
  // verification is a safe no-op (same DSN-guarded pattern as Sentry above) — set it
  // to actually start enforcing the check on login/forgot-password.
  TURNSTILE_SECRET_KEY: z.string().optional().default(''),

  // AI provider keys — server-side only (Spec §7, §10). All optional: features
  // degrade gracefully (rule-based fallback) when the configured provider has no key.
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
