import { createHash, randomBytes } from 'node:crypto';

/** Opaque token utilities for refresh / invite / reset tokens (Spec §5.1, §10). */

/** A cryptographically-random opaque token (returned to the client, never stored raw). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** Only the hash is persisted, so a DB leak does not expose usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
