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
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // best-effort — clear local state regardless of network outcome
    }
    this.setSession(null, null);
  }

  /** Launch-time: resume a session from the persisted refresh-token cookie, if any. */
  async attemptSilentRefresh(): Promise<boolean> {
    try {
      const res = await this.api.refresh();
      this.setSession(res.user, res.accessToken);
      return true;
    } catch {
      this.setSession(null, null);
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
