import { app, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Local marker written at OS shutdown and reconciled into a checkout next launch. */
export function shutdownMarkerPath(): string {
  return join(app.getPath('userData'), 'pending-shutdown.flag');
}

/**
 * A network checkout can't reliably complete during a Windows shutdown — the
 * process is killed before the request goes out. So instead we drop a tiny local
 * marker (a fast, synchronous file write) when the OS session ends, and the NEXT
 * launch (index.ts) turns it into a real checkout, closing the session at its last
 * heartbeat. Deliberately NOT wired to app quit / window close: quitting or closing
 * to the tray must keep the session open (the agreed design — only a manual Check
 * Out or a real shutdown ends it). The nightly server sweep remains the last-resort
 * fallback if even `session-end` doesn't fire (e.g. battery pull, hard power-off).
 */
export function registerShutdownHandler(mainWindow: BrowserWindow): void {
  mainWindow.on('session-end', () => {
    try {
      writeFileSync(shutdownMarkerPath(), new Date().toISOString());
    } catch {
      // best effort — the nightly sweep still closes the session
    }
  });
}
