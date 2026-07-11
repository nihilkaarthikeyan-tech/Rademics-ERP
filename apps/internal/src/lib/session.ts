'use client';

// Access token lives in memory-backed localStorage; the refresh token is an
// httpOnly cookie the browser sends automatically (Spec §5.1).
const KEY = 'rademics_at';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(KEY);
}
