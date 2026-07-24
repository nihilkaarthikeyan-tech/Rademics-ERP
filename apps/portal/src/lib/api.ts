'use client';

import { getToken, setToken } from './session';

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

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
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
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  email: string;
  role: string;
  resourceType: string;
}
