import { randomUUID } from 'node:crypto';
import { ApiClient, ApiError, type AttendanceSessionPayload } from './api-client';
import type { AuthState, AuthUserPayload, TodayStatus } from '../shared/ipc';

type AuthListener = (state: AuthState) => void;

/**
 * Owns the current auth session (access token in memory only, never written to
 * disk) and every authenticated call, transparently retrying once on a 401 by
 * silently refreshing via the persisted refresh-token cookie — mirrors the
 * check-in/out/heartbeat/today contract the website already uses unchanged.
 */
export class AuthStore {
  private user: AuthUserPayload | null = null;
  private listeners = new Set<AuthListener>();
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly api: ApiClient) {}

  get authenticated(): boolean {
    return this.user !== null;
  }

  getState(): AuthState {
    return { authenticated: this.authenticated, user: this.user };
  }

  onChange(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSession(user: AuthUserPayload | null, token: string | null): void {
    this.user = user;
    this.api.setAccessToken(token);
    const state = this.getState();
    for (const l of this.listeners) l(state);
  }

  async login(email: string, password: string, captchaToken: string | null): Promise<void> {
    const res = await this.api.login(email, password, captchaToken);
    this.setSession(res.user, res.accessToken);
    // Force the refresh cookie to disk NOW — Electron flushes lazily, and a hard
    // kill (shutdown) before the flush would strand an already-rotated cookie.
    await this.api.flushCookies();
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // best-effort — clear local state regardless of network outcome
    }
    this.setSession(null, null);
  }

  /**
   * Resume/renew the session from the persisted refresh-token cookie. SINGLE-FLIGHT:
   * concurrent 401s (poller + heartbeat + today waking together after sleep) must
   * share ONE refresh call — parallel refreshes race, and the loser presents an
   * already-rotated token, which the server treats as theft and revokes the whole
   * session family (the "randomly signed out after sleep" bug).
   */
  attemptSilentRefresh(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const res = await this.api.refresh();
      this.setSession(res.user, res.accessToken);
      // Persist the rotated cookie immediately — a hard kill before Electron's lazy
      // flush would leave the old (now revoked) token on disk for the next launch.
      await this.api.flushCookies();
      return true;
    } catch (err) {
      // Only a definitive server rejection (invalid/expired refresh token) ends the
      // session. Transient failures — network still down seconds after wake-from-sleep,
      // a server restart, a 5xx — must NOT sign the user out; the 20s poller simply
      // retries. (ApiError is only thrown for real HTTP responses; network failures
      // reject with a plain Error.)
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        this.setSession(null, null);
      }
      return false;
    }
  }

  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const refreshed = await this.attemptSilentRefresh();
        if (refreshed) return fn();
      }
      throw err;
    }
  }

  checkIn(): Promise<AttendanceSessionPayload> {
    return this.withAuth(() => this.api.checkIn(randomUUID()));
  }

  checkOut(reconcile = false): Promise<AttendanceSessionPayload> {
    return this.withAuth(() => this.api.checkOut(reconcile));
  }

  heartbeat(): Promise<{ idleSeconds: number; checkedIn: boolean }> {
    return this.withAuth(() => this.api.heartbeat());
  }

  today(): Promise<TodayStatus> {
    return this.withAuth(() => this.api.today());
  }
}
