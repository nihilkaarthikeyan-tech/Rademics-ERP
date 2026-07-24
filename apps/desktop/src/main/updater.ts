import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/ipc';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // re-check every 4h while the app stays open

/**
 * Self-hosted auto-update (electron-updater's "generic" provider, pointed at
 * electron-builder.yml's `publish.url`). Nobody gets an update unless that VPS
 * location is deliberately republished (see .github/workflows/desktop-installer.yml
 * with publish=true) — this only ever checks OUR feed, never a third party.
 *
 * Downloads happen silently in the background; the new version only takes effect
 * once the employee restarts the app (never mid-session, never forced).
 */
export function setupAutoUpdater(onStatus: (status: UpdateStatus) => void): void {
  if (!app.isPackaged) return; // dev/unpackaged runs never check — irrelevant until installed

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if they quit normally, apply it then too

  autoUpdater.on('checking-for-update', () => onStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => onStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => onStatus({ state: 'not-available' }));
  autoUpdater.on('download-progress', () => onStatus({ state: 'downloading' }));
  autoUpdater.on('update-downloaded', (info) => onStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', () => onStatus({ state: 'error' }));

  void autoUpdater.checkForUpdates().catch(() => undefined);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), CHECK_INTERVAL_MS);
}

/** Restart now to apply an already-downloaded update. No-op if none is ready. */
export function restartToInstallUpdate(): void {
  // isSilent=true → NSIS runs with /S: no installer wizard, the app just closes,
  // updates, and relaunches (isForceRunAfter=true). The wizard is for first
  // installs only — updates should be invisible.
  autoUpdater.quitAndInstall(true, true);
}
