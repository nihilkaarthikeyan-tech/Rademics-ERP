import type { AuthStore } from './auth-store';
import type { StatusUpdatePayload, TodayStatus } from '../shared/ipc';
import { ApiError } from './api-error';

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
  /** Last server answer; null = not known yet (or the signed-in user changed). */
  private lastCheckedIn: boolean | null = null;
  private lastStatus: TodayStatus | null = null;
  private listeners = new Set<StatusListener>();

  constructor(private readonly auth: AuthStore) {
    auth.onChange(() => {
      this.lastCheckedIn = null;
      this.lastStatus = null;
    });
  }

  /**
   * True only when the server has said this user is NOT checked in. The idle
   * tracker skips heartbeats then — the API rejects them with 400 "You are not
   * checked in" (hundreds a day before this). Unknown counts as checked in, so
   * a real session never misses a heartbeat on a stale answer.
   */
  knownCheckedOut(): boolean {
    return this.lastCheckedIn === false;
  }

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
    this.lastCheckedIn = false;
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
    this.lastCheckedIn = null;
    this.lastStatus = null;
  }

  async tick(): Promise<void> {
    if (!this.auth.authenticated) return;
    try {
      const status = await this.auth.today();
      const autoCheckedOut = this.prevCheckedIn === true && !status.checkedIn;
      this.prevCheckedIn = status.checkedIn;
      this.lastCheckedIn = status.checkedIn;
      this.lastStatus = status;
      const payload: StatusUpdatePayload = { status, autoCheckedOut, offline: false };
      for (const l of this.listeners) l(payload);
    } catch (err) {
      // Couldn't reach the server (or it's restarting): keep showing the last
      // figures and say so — the idle tracker is saving activity meanwhile.
      if (err instanceof ApiError && err.status < 500) return;
      if (!this.lastStatus) return;
      const payload: StatusUpdatePayload = { status: this.lastStatus, autoCheckedOut: false, offline: true };
      for (const l of this.listeners) l(payload);
    }
  }
}
