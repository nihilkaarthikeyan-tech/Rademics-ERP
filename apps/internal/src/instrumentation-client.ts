import * as Sentry from '@sentry/nextjs';

/**
 * Browser Sentry init (Spec §11). DSN-guarded no-op: needs NEXT_PUBLIC_SENTRY_DSN
 * (public by necessity for client reporting). Without it, nothing initialises.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Must match the release the source maps were uploaded under, or stack traces stay
    // minified (Spec §11). Public by necessity, like the DSN — it's only a git SHA.
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
