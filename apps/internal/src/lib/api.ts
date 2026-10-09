'use client';

import { getToken, setToken } from './session';
import { desktopHost } from './desktop-host';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The access token expires after 15 minutes; the httpOnly refresh cookie lasts 7 days.
// On a 401, silently exchange the cookie for a fresh access token and retry once —
// otherwise every page load 15+ minutes after login bounces to the login screen.
// Shared in-flight promise so concurrent 401s trigger a single refresh call.
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    // Inside the desktop app: the app holds the session. Take its current token
    // if ours is stale, otherwise ask it to renew.
    const host = desktopHost();
    if (host) {
      try {
        const current = await host.getToken();
        const token = current && current !== getToken() ? current : await host.refreshToken();
        if (!token) return false;
        setToken(token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    }
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const json = (await res.json().catch(() => ({}))) as { accessToken?: string };
      if (!json.accessToken) return false;
      setToken(json.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * What to actually show the user. Nest's ValidationPipe sends `message` as an
 * ARRAY of field complaints; handing that straight to `new Error()` stringified
 * it as "qty must be positive,GST % must be between 0 and 28" — one run-on line
 * with no space after the comma. Join it properly, and never fall back to a bare
 * status code, which tells the user nothing they can act on.
 */
function errorMessage(message: string | string[] | undefined, res: Response): string {
  if (Array.isArray(message)) {
    const parts = message.filter((m) => typeof m === 'string' && m.trim());
    if (parts.length === 1) return parts[0]!;
    if (parts.length > 1) return parts.join('. ') + '.';
  } else if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (res.status === 401) return 'Your session has ended — please sign in again.';
  if (res.status === 403) return 'You do not have permission to do that.';
  if (res.status === 404) return 'That item could not be found.';
  if (res.status === 429) return 'Too many attempts — please wait a moment and try again.';
  if (res.status >= 500) return 'Something went wrong on our side. Please try again.';
  return res.statusText || 'The request could not be completed.';
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const doFetch = () => {
    const token = getToken();
    return fetch(`${API_BASE}${path}`, {
      ...opts,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  };

  let res = await doFetch();
  const canRetry = !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh');
  if (res.status === 401 && canRetry && (await tryRefresh())) {
    res = await doFetch();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new ApiError(res.status, errorMessage(body.message, res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  email: string;
  role: string;
  resourceType: string;
  desktopCheckInRequired: boolean;
}
