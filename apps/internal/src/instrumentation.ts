import * as Sentry from '@sentry/nextjs';

/**
 * Server/edge Sentry init (Spec §11). DSN-guarded: with no SENTRY_DSN nothing is sent
 * and this is a no-op, so local/dev never phones home and no secret is required.
 */
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({ dsn, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
  }
}

// Capture errors thrown in React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError;
