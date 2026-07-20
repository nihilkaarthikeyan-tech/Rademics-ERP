import type { AuthStore } from './auth-store';
import type { StatusUpdatePayload } from '../shared/ipc';

const POLL_MS = 20_000;

type StatusListener = (payload: StatusUpdatePayload) => void;

/**
 * Polls GET /attendance/today every 20s, mirroring attendance-context.tsx —
 * this is how both the website and this app learn about server-driven state
 * changes (e.g. the nightly auto-close sweep) without a WebSocket push.
 */
export class StatusPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevCheckedIn: boolean | null = null;
  private listeners = new Set<StatusListener>();

  constructor(private readonly auth: AuthStore) {}

  onUpdate(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Call right after a MANUAL check-out so the next poll doesn't mistake the
   * expected checked-in -> checked-out transition for a server-driven idle
   * auto-checkout (mirrors attendance-context.tsx's manualCheckoutInFlight guard).
   */
  noteManualCheckout(): void {
    this.prevCheckedIn = false;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.prevCheckedIn = null;
  }

  async tick(): Promise<void> {
    if (!this.auth.authenticated) return;
    try {
      const status = await this.auth.today();
      const autoCheckedOut = this.prevCheckedIn === true && !status.checkedIn;
      this.prevCheckedIn = status.checkedIn;
      const payload: StatusUpdatePayload = { status, autoCheckedOut };
      for (const l of this.listeners) l(payload);
    } catch {
      // transient network error — the next tick retries
    }
  }
}
