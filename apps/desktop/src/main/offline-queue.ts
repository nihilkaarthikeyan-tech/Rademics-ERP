import { readFileSync, writeFileSync } from 'node:fs';

/** One per minute is plenty (idle needs a 10-min silence); a full day is 1440. */
const MAX_ENTRIES = 1500;

interface Stored {
  userId: string;
  at: string[];
}

/**
 * Moments of real keyboard/mouse activity the app saw while it couldn't reach
 * the server. Sent with the next heartbeat that gets through, so the server
 * replays them and working through an internet drop isn't charged as idle.
 *
 * Kept on disk so an app restart mid-outage doesn't lose them, and tagged with
 * the signed-in user so one person's activity can never be credited to another
 * who signs in on the same machine. Electron-free on purpose (testable in CI).
 */
export class OfflineQueue {
  private userId: string | null = null;
  private at: string[] = [];

  constructor(private readonly file: string) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
      if (typeof stored.userId === 'string' && Array.isArray(stored.at)) {
        this.userId = stored.userId;
        this.at = stored.at.filter((s) => typeof s === 'string');
      }
    } catch {
      // no file yet, or unreadable — start empty
    }
  }

  /** Entries for this user; anything saved under someone else is discarded. */
  pending(userId: string): string[] {
    if (this.userId !== userId) this.reset(userId);
    return this.at;
  }

  /** Record activity at `when`, at most one entry per minute. */
  add(userId: string, when: Date): void {
    this.pending(userId);
    const minute = when.toISOString().slice(0, 16);
    if (this.at.some((s) => s.startsWith(minute))) return;
    this.at.push(when.toISOString());
    if (this.at.length > MAX_ENTRIES) this.at.splice(0, this.at.length - MAX_ENTRIES);
    this.save();
  }

  /** Drop exactly what was delivered — anything added meanwhile stays queued. */
  remove(sent: string[]): void {
    if (!sent.length) return;
    const delivered = new Set(sent);
    this.at = this.at.filter((s) => !delivered.has(s));
    this.save();
  }

  private reset(userId: string): void {
    this.userId = userId;
    this.at = [];
    this.save();
  }

  private save(): void {
    if (!this.userId) return;
    try {
      writeFileSync(this.file, JSON.stringify({ userId: this.userId, at: this.at } satisfies Stored));
    } catch {
      // best effort — worst case the outage counts as idle, as it did before
    }
  }
}
