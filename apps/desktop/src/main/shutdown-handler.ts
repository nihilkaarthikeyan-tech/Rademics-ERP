import { app, type BrowserWindow } from 'electron';
import type { AuthStore } from './auth-store';

/**
 * Best-effort checkout when Windows is shutting down, restarting, or the user
 * logs off — NOT on a plain window close (the window is intercepted to hide to
 * the tray instead, see main/index.ts). This is intentionally best-effort: OS
 * shutdown gives an app very little guaranteed time to finish async work, so the
 * existing nightly auto-close sweep (attendance-compute.service.ts) remains the
 * guaranteed fallback for anything this misses.
 */
export function registerShutdownHandler(auth: AuthStore, mainWindow: BrowserWindow): void {
  let attempted = false;

  const attemptCheckout = () => {
    if (attempted || !auth.authenticated) return;
    attempted = true;
    // Fire-and-forget: don't block shutdown waiting on the network.
    void auth.checkOut().catch(() => undefined);
  };

  // Windows: fired on the window's session ending (shutdown/restart/logoff) —
  // a BrowserWindow event, not an app-level one.
  mainWindow.on('session-end', attemptCheckout);
  // Fired once the app is actually quitting (tray "Quit", or the OS force-closing it).
  app.on('before-quit', attemptCheckout);
}
