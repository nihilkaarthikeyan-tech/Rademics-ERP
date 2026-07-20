import { net } from 'electron';
import type { Session } from 'electron';
import type { AuthUserPayload, TodayStatus } from '../shared/ipc';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AttendanceSessionPayload {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  idleSeconds: number;
  autoClosed: boolean;
  lastHeartbeatAt: string | null;
  source: 'WEB' | 'DESKTOP';
}

interface TokenResponse {
  accessToken: string;
  user: AuthUserPayload;
}

/**
 * All backend communication for the desktop app. Deliberately runs in the main
 * process, not the renderer: `net.request` bound to a persistent session partition
 * gets automatic httpOnly-cookie handling for the refresh token (like a real
 * browser session) without being subject to renderer-side CORS/SameSite rules —
 * see the implementation plan for why this avoids touching apps/api's CORS config.
 */
export class ApiClient {
  private accessToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly session: Session,
  ) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  login(email: string, password: string, captchaToken: string | null): Promise<TokenResponse> {
    return this.request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: { email, password, captchaToken },
      auth: false,
    });
  }

  refresh(): Promise<TokenResponse> {
    return this.request<TokenResponse>('/auth/refresh', { method: 'POST', body: {}, auth: false });
  }

  logout(): Promise<void> {
    return this.request<void>('/auth/logout', { method: 'POST', body: {} });
  }

  checkIn(idempotencyKey: string): Promise<AttendanceSessionPayload> {
    return this.request<AttendanceSessionPayload>('/attendance/check-in', {
      method: 'POST',
      body: { idempotencyKey, source: 'DESKTOP' },
    });
  }

  checkOut(): Promise<AttendanceSessionPayload> {
    return this.request<AttendanceSessionPayload>('/attendance/check-out', {
      method: 'POST',
      body: {},
    });
  }

  heartbeat(): Promise<{ idleSeconds: number; checkedIn: boolean }> {
    return this.request('/attendance/heartbeat', { method: 'POST', body: {} });
  }

  today(): Promise<TodayStatus> {
    return this.request<TodayStatus>('/attendance/today', { method: 'GET' });
  }

  private request<T>(
    path: string,
    opts: { method: string; body?: unknown; auth?: boolean },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = net.request({
        method: opts.method,
        url: `${this.baseUrl}${path}`,
        session: this.session,
        credentials: 'include',
      });
      req.setHeader('content-type', 'application/json');
      if (opts.auth !== false && this.accessToken) {
        req.setHeader('authorization', `Bearer ${this.accessToken}`);
      }

      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode;
          let parsed: unknown;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = undefined;
            }
          }
          if (status >= 200 && status < 300) {
            resolve(parsed as T);
          } else {
            const message =
              (parsed as { message?: string } | undefined)?.message ?? `Request failed (${status})`;
            reject(new ApiError(status, message));
          }
        });
        res.on('error', (err: Error) => reject(err));
      });
      req.on('error', (err: Error) => reject(err));

      if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
      req.end();
    });
  }
}
