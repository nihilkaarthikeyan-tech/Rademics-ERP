'use client';

/**
 * Present when this page runs inside the Rademics desktop app's chat window
 * (its preload exposes it). The app is already signed in, so the page takes
 * its access token from there instead of relying on its own refresh cookie.
 */
export interface DesktopHost {
  kind: 'desktop';
  getToken(): Promise<string | null>;
  refreshToken(): Promise<string | null>;
}

export function desktopHost(): DesktopHost | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { rademicsHost?: DesktopHost }).rademicsHost ?? null;
}
