import * as Sentry from '@sentry/nextjs';

/**
 * Browser Sentry init (Spec §11). DSN-guarded no-op: needs NEXT_PUBLIC_SENTRY_DSN
 * (public by necessity for client reporting). Without it, nothing initialises.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, environment: process.env.NODE_ENV, tracesSampleRate: 0.1 });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
