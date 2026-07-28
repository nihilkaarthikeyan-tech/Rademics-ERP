import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Is this account still entitled to make requests, right now?
 *
 * Access tokens are stateless and short-lived, which is what makes them fast —
 * and also what made deactivation advisory: revoking refresh tokens did nothing
 * to the access token already in the fired employee's browser, so they kept
 * working for up to its full lifetime. Same for a demotion: the old role rode
 * along in the token.
 *
 * So the guard asks here on every request. A naive lookup would put a query in
 * front of every API call, so answers are cached briefly — and, crucially, the
 * cache is dropped the instant this process revokes someone. That makes
 * revocation immediate for the action that caused it, and bounded by TTL_MS for
 * anything that changed the row behind our back (a second API instance, or a
 * hand-edit in the database).
 */
const TTL_MS = 20_000;

interface Entry {
  status: string;
  sessionsRevokedAt: Date | null;
  readAt: number;
}

@Injectable()
export class SessionStateService {
  private readonly cache = new Map<string, Entry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param userId  from the verified token
   * @param issuedAtSeconds  the token's `iat` claim
   * @returns why the token is no longer good, or null when it is fine
   */
  async rejectionReason(userId: string, issuedAtSeconds?: number): Promise<string | null> {
    const entry = await this.read(userId);
    if (!entry) return 'Account no longer exists';
    if (entry.status !== 'ACTIVE') return 'Account is no longer active';
    if (entry.sessionsRevokedAt && issuedAtSeconds !== undefined) {
      // One second of slack: `iat` is whole seconds, so a token minted in the
      // same second as a revocation would otherwise be thrown away immediately
      // — including the new token issued BY a password change.
      if (entry.sessionsRevokedAt.getTime() > issuedAtSeconds * 1000 + 1000) {
        return 'Session ended — please sign in again';
      }
    }
    return null;
  }

  /** Called after revoking; makes the next request see it without waiting for TTL. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  private async read(userId: string): Promise<Entry | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.readAt < TTL_MS) return hit;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, sessionsRevokedAt: true },
    });
    if (!row) {
      this.cache.delete(userId);
      return null;
    }
    const entry: Entry = { status: row.status, sessionsRevokedAt: row.sessionsRevokedAt, readAt: Date.now() };
    this.cache.set(userId, entry);
    return entry;
  }
}
