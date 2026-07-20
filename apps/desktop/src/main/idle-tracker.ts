import { powerMonitor } from 'electron';
import type { AuthStore } from './auth-store';

const POLL_MS = 20_000;

/**
 * OS-level equivalent of the website's DOM-activity heartbeat gate
 * (attendance-context.tsx): only pings /attendance/heartbeat when there was
 * real input since the last poll window, using powerMonitor.getSystemIdleTime()
 * instead of mousemove/keydown/click/scroll listeners. The server computes idle
 * time purely from the gap between heartbeat calls — no changes needed there.
 */
export class IdleTracker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly auth: AuthStore) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.auth.authenticated) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds < POLL_MS / 1000) {
      try {
        await this.auth.heartbeat();
      } catch {
        // transient network error — the next tick retries
      }
    }
  }
}
