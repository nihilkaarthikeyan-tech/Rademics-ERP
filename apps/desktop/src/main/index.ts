import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { ApiClient } from './api-client';
import { AuthStore } from './auth-store';
import { IdleTracker } from './idle-tracker';
import { StatusPoller } from './status-poller';
import { registerShutdownHandler } from './shutdown-handler';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import { startLocalServer } from './local-server';

// A packaged build (what employees install) talks to production by default; a dev
// run (`pnpm dev`, unpackaged) talks to the local stack. Either can be overridden
// with the env vars. The Turnstile site key is public (it's embedded in the web
// login page too), so baking the prod default in is safe.
const PROD_API_URL = 'https://api.52digit.com/api';
const PROD_TURNSTILE_SITE_KEY = '0x4AAAAAAD28tPjtuZ5KvO2e';
const API_BASE_URL =
  process.env.RADEMICS_API_URL ?? (app.isPackaged ? PROD_API_URL : 'http://localhost:4000/api');
const TURNSTILE_SITE_KEY =
  process.env.RADEMICS_TURNSTILE_SITE_KEY ?? (app.isPackaged ? PROD_TURNSTILE_SITE_KEY : null);

// Hard requirement: this app must never launch itself. Explicit, not just the
// default, so the intent survives even if something upstream changes it.
app.setLoginItemSettings({ openAtLogin: false });

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
    const api = new ApiClient(API_BASE_URL, desktopSession);
    const auth = new AuthStore(api);
    const idleTracker = new IdleTracker(auth);
    const statusPoller = new StatusPoller(auth);

    const win = new BrowserWindow({
      width: 380,
      height: 560,
      resizable: false,
      minimizable: true,
      maximizable: false,
      title: 'Rademics ERP Desktop Agent',
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

    registerIpcHandlers({ auth, statusPoller, mainWindow: win, turnstileSiteKey: TURNSTILE_SITE_KEY });
    registerShutdownHandler(auth, win);

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

    // Resume a session from the persisted refresh-token cookie, if any, then
    // start the always-on polling loops (both no-op internally while logged out).
    await auth.attemptSilentRefresh();
    idleTracker.start();
    statusPoller.start();
  });

  app.on('window-all-closed', () => {
    // Tray app: stay resident. Real quit only happens via the tray menu or OS shutdown.
  });
}
