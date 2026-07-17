import * as Sentry from '@sentry/node';

/**
 * Sentry init (Spec §11). MUST be imported before any instrumented module, so this
 * file is the very first import in main.ts. DSN-guarded: with no SENTRY_DSN the SDK
 * is never initialised and every Sentry call is a silent no-op — nothing is sent in
 * dev/local, and no secret is required to boot.
 */
const dsn = process.env.SENTRY_DSN;

export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Stamps every event with the deployed commit, so an issue says which release
    // introduced it and regressions are detected on redeploy (Spec §11). Baked in at
    // image build time from the git SHA; undefined => Sentry just won't group by release.
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
    // Keep PII server-side; the audit log is the system of record for who-did-what.
    sendDefaultPii: false,
  });
}
