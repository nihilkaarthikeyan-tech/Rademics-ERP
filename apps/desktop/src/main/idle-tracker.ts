import { powerMonitor } from 'electron';
import type { AuthStore } from './auth-store';
import { ApiError } from './api-error';
import type { OfflineQueue } from './offline-queue';

const POLL_MS = 20_000;

/**
 * OS-level equivalent of the website's DOM-activity heartbeat gate
 * (attendance-context.tsx): only pings /attendance/heartbeat when there was
 * real input since the last poll window, using powerMonitor.getSystemIdleTime()
 * instead of mousemove/keydown/click/scroll listeners. The server computes idle
 * time purely from the gap between heartbeat calls.
 *
 * When a heartbeat can't get through (no internet, server restarting), the
 * moment is saved in the offline queue and sent with the next one that does —
 * the server replays them, so working through an outage isn't counted as idle.
 */
export class IdleTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending: Promise<void> | null = null;

  constructor(
    private readonly auth: AuthStore,
    /** From StatusPoller — no heartbeats while the server says checked out. */
    private readonly isCheckedOut: () => boolean,
    private readonly queue: OfflineQueue,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Deliver anything saved offline now — called before a manual check-out. */
  async flush(): Promise<void> {
    const userId = this.auth.getState().user?.id;
    if (!userId || !this.queue.pending(userId).length) return;
    await this.send(userId, null);
  }

  private async tick(): Promise<void> {
    const userId = this.auth.getState().user?.id;
    if (!userId || this.isCheckedOut()) return;
    const active = powerMonitor.getSystemIdleTime() < POLL_MS / 1000;
    // Idle and nothing saved: nothing to say. Idle but holding offline activity:
    // still try, so it reaches the server as soon as the connection is back.
    if (!active && !this.queue.pending(userId).length) return;
    await this.send(userId, active ? new Date() : null);
  }

  private send(userId: string, activeAt: Date | null): Promise<void> {
    // One delivery at a time, so a slow request can't race a retry of the same queue.
    if (this.sending) return this.sending;
    this.sending = (async () => {
      const batch = [...this.queue.pending(userId)];
      try {
        await this.auth.heartbeat(batch);
        this.queue.remove(batch);
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) {
          // The server answered and refused (e.g. 400 not checked in any more) —
          // the saved moments have no session to land in.
          this.queue.remove(batch);
        } else if (activeAt) {
          // Unreachable, or the server is restarting (5xx): keep this moment.
          this.queue.add(userId, activeAt);
        }
      } finally {
        this.sending = null;
      }
    })();
    return this.sending;
  }
}
