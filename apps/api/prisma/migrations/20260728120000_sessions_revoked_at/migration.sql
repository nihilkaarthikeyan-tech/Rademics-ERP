-- Instant session revocation: access tokens issued before this moment are refused.
-- Without it, deactivation and role changes only revoked REFRESH tokens, so an
-- access token kept working for its full ~15 minute life.
ALTER TABLE "users" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
