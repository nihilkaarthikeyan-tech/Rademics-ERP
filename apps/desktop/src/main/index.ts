import { join } from 'node:path';
import { app, BrowserWindow, Menu, powerMonitor, session } from 'electron';
import { ApiClient } from './api-client';
import { AuthStore } from './auth-store';
import { IdleTracker } from './idle-tracker';
import { StatusPoller } from './status-poller';
import { existsSync, unlinkSync } from 'node:fs';
import { registerShutdownHandler, shutdownMarkerPath } from './shutdown-handler';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import { startLocalServer } from './local-server';
import { setupAutoUpdater } from './updater';
import { IpcChannel } from '../shared/ipc';

// A packaged build (what employees install) talks to production by default; a dev
// run (`pnpm dev`, unpackaged) talks to the local stack. Either can be overridden
// with the env vars. The Turnstile site key is public (it's embedded in the web
// login page too), so baking the prod default in is safe.
const PROD_API_URL = 'https://api.52digit.com/api';
const API_BASE_URL =
  process.env.RADEMICS_API_URL ?? (app.isPackaged ? PROD_API_URL : 'http://localhost:4000/api');
// Shared key that lets the API skip the browser CAPTCHA for this native app.
// Injected at build time (electron.vite.config.ts define) — empty in dev, where the
// local API has no CAPTCHA secret set anyway. Not a real secret (extractable from the
// binary); the login rate limit + account lockout are the actual bot protections.
const DESKTOP_APP_KEY = (process.env.RADEMICS_DESKTOP_KEY as string) || null;

// Keep the ORIGINAL userData folder across the 0.2.5 product rename ("Rademics ERP
// Desktop Agent" → "Rademics Work Monitoring App"): Electron derives the default
// userData path from the product name, and letting it move would silently drop every
// installed user's session cookie + saved login + shutdown marker on update.
if (app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Rademics ERP Desktop Agent'));
}

// Hard requirement: this app must never launch itself. Explicit, not just the
// default, so the intent survives even if something upstream changes it.
app.setLoginItemSettings({ openAtLogin: false });

// Remove Electron's default menu bar (File/Edit/View/Window/Help). This is a
// single-purpose employee app, not a document editor — the defaults just expose
// Reload / Toggle DevTools / zoom that employees have no reason to touch.
Menu.setApplicationMenu(null);

// One tray-resident instance at a time — a second launch just focuses the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    const desktopSession = session.fromPartition('persist:rademics-desktop');
    const api = new ApiClient(API_BASE_URL, desktopSession, DESKTOP_APP_KEY);
    const auth = new AuthStore(api);
    const idleTracker = new IdleTracker(auth);
    const statusPoller = new StatusPoller(auth);

    const win = new BrowserWindow({
      width: 380,
      height: 560,
      resizable: false,
      minimizable: true,
      maximizable: false,
      title: 'Rademics Work Monitoring App',
      icon: join(__dirname, '../../assets/icon.png'),
      webPreferences: {
        session: desktopSession,
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow = win;

    const isQuitting = { value: false };
    win.on('close', (event) => {
      // Closing the window must NOT check the employee out — it keeps tracking
      // in the background, hidden to the tray. Only an explicit Quit or a real
      // system shutdown (shutdown-handler.ts) ends the session.
      if (!isQuitting.value) {
        event.preventDefault();
        win.hide();
      }
    });
    app.on('before-quit', () => {
      isQuitting.value = true;
    });

    const tray = createTray({ mainWindow: win, isQuitting });
    statusPoller.onUpdate((payload) => tray.setCheckedIn(payload.status?.checkedIn ?? false));

    registerIpcHandlers({ auth, statusPoller, mainWindow: win });
    registerShutdownHandler(win);

    if (process.env.ELECTRON_RENDERER_URL) {
      // electron-vite dev server — already serves over http://localhost.
      await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      // Packaged build: serve over http://localhost too (not file://), since
      // Cloudflare Turnstile needs a real hostname to validate against.
      const rendererDir = join(__dirname, '../renderer');
      const { url } = await startLocalServer(rendererDir);
      await win.loadURL(url);
    }

    // Resume a session from the persisted refresh-token cookie, if any.
    await auth.attemptSilentRefresh();

    // If the machine was shut down while checked in, a marker was left behind that
    // the shutdown couldn't turn into a checkout. Complete it now — the server
    // closes the session at its last heartbeat, so the powered-off time isn't
    // counted. Runs before the pollers so the first status already reads correctly.
    if (existsSync(shutdownMarkerPath())) {
      if (auth.authenticated) {
        try {
          await auth.checkOut(true);
        } catch {
          // already closed / session expired — the nightly sweep covers it
        }
      }
      try {
        unlinkSync(shutdownMarkerPath());
      } catch {
        /* ignore */
      }
    }

    // Start the always-on polling loops (both no-op internally while logged out).
    idleTracker.start();
    statusPoller.start();

    // When the machine wakes from sleep or the screen unlocks, the poll timers were
    // suspended — refresh immediately so the UI doesn't linger on stale data.
    powerMonitor.on('resume', () => void statusPoller.tick());
    powerMonitor.on('unlock-screen', () => void statusPoller.tick());

    // Silent background check against our own self-hosted update feed (never a
    // third party) — see electron-builder.yml `publish`. No-op in dev builds.
    setupAutoUpdater((status) => {
      if (!win.isDestroyed()) win.webContents.send(IpcChannel.UpdateStatusChanged, status);
    });
  });

  app.on('window-all-closed', () => {
    // Tray app: stay resident. Real quit only happens via the tray menu or OS shutdown.
  });
}
