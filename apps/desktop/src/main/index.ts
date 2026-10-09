import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, Notification, powerMonitor, session } from 'electron';
import { ApiClient } from './api-client';
import { AuthStore } from './auth-store';
import { IdleTracker } from './idle-tracker';
import { OfflineQueue } from './offline-queue';
import { StatusPoller } from './status-poller';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { registerShutdownHandler, shutdownMarkerPath } from './shutdown-handler';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import { startLocalServer } from './local-server';
import { setupAutoUpdater } from './updater';
import { ChatWatcher } from './chat-watcher';
import { ChatWindow } from './chat-window';
import { unreadBadge } from './badge';
import { IpcChannel } from '../shared/ipc';
import { openExternalIfAllowed } from './open-external';
import { originOf } from './url-guard';

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
// The staff website — the chat window shows its chat screen. Dev runs use the
// local staff app.
const PROD_WEB_URL = 'https://rademics.52digit.com';
const WEB_URL = process.env.RADEMICS_WEB_URL ?? (app.isPackaged ? PROD_WEB_URL : 'http://localhost:3000');
// The file-storage server chat attachments are served from — the only place the
// chat window downloads files from. Dev runs use the local MinIO.
const PROD_STORAGE_URL = 'https://storage.52digit.com';
const STORAGE_URL =
  process.env.RADEMICS_STORAGE_URL ?? (app.isPackaged ? PROD_STORAGE_URL : 'http://localhost:9000');

// Windows only shows notifications from an app with an identity: the installer
// registers the appId; an unpackaged dev run has to name itself.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.rademics.erp.desktop-agent' : process.execPath);
}

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
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    const desktopSession = session.fromPartition('persist:rademics-desktop');
    const api = new ApiClient(API_BASE_URL, desktopSession, DESKTOP_APP_KEY);
    const auth = new AuthStore(api);
    const statusPoller = new StatusPoller(auth);
    const offlineQueue = new OfflineQueue(join(app.getPath('userData'), 'offline-activity.json'));
    const idleTracker = new IdleTracker(auth, () => statusPoller.knownCheckedOut(), offlineQueue);

    const win = new BrowserWindow({
      width: 380,
      height: 640,
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

    // The window only ever shows the app's own screens. A link that tries to open
    // a new window goes to the normal browser (web and email links only), and the
    // window itself never navigates away. The renderer's address is known once
    // it is loaded below; until then nothing is let through.
    let rendererOrigin: string | null = null;
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      openExternalIfAllowed(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      if (rendererOrigin === null || originOf(target) !== rendererOrigin) {
        event.preventDefault();
        openExternalIfAllowed(target);
      }
    });

    const isQuitting = { value: false };
    win.on('close', (event) => {
      // Closing the window must NOT check the employee out — it keeps tracking
      // in the background, hidden to the tray (the tray icon carries the unread
      // dot and count). Only an explicit Quit or a real system shutdown
      // (shutdown-handler.ts) ends the session. 0.2.12 minimized to the taskbar
      // instead, which read as "the app won't close", so this is back to hiding.
      if (!isQuitting.value) {
        event.preventDefault();
        win.hide();
        // Say so once, so nobody thinks closing it stopped their attendance.
        const hintFlag = join(app.getPath('userData'), 'tray-hint-shown');
        if (!existsSync(hintFlag)) {
          new Notification({
            title: 'Rademics is still running',
            body: 'Your attendance and chat keep working. Find the app in the tray by the clock; right-click it and choose Quit to close it fully.',
          }).show();
          try {
            writeFileSync(hintFlag, new Date().toISOString());
          } catch {
            /* not critical: the note may simply show again next time */
          }
        }
      }
    });
    app.on('before-quit', () => {
      isQuitting.value = true;
    });

    // Chat: a live feed that pops up Windows notifications, and a chat window.
    let watcher: ChatWatcher | null = null;
    const chatWindow = new ChatWindow(WEB_URL, auth, () => void watcher?.refreshUnread(), [
      originOf(STORAGE_URL) ?? PROD_STORAGE_URL,
    ]);
    const tray = createTray({ mainWindow: win, isQuitting, openChat: () => chatWindow.open() });
    watcher = new ChatWatcher(auth, API_BASE_URL.replace(/\/api\/?$/, ''), {
      isChatFocused: () => chatWindow.isFocused(),
      openChat: (roomId, messageId) => chatWindow.open(roomId, messageId),
      onUnread: (count) => {
        tray.setUnread(count);
        // The red number on the taskbar button (Windows overlay badge).
        const badge = count > 0 ? unreadBadge(count) : null;
        const label = count > 0 ? `${count} unread message${count === 1 ? '' : 's'}` : '';
        if (!win.isDestroyed()) {
          win.setOverlayIcon(badge, label);
          win.webContents.send(IpcChannel.ChatUnreadChanged, count);
        }
        chatWindow.setBadge(badge, label);
      },
    });
    ipcMain.handle(IpcChannel.ChatOpen, () => chatWindow.open());
    ipcMain.handle(IpcChannel.ChatGetUnread, () => watcher?.unreadCount ?? 0);
    statusPoller.onUpdate((payload) => tray.setCheckedIn(payload.status?.checkedIn ?? false));

    registerIpcHandlers({ auth, statusPoller, idleTracker, mainWindow: win });
    registerShutdownHandler(win);

    if (process.env.ELECTRON_RENDERER_URL) {
      // electron-vite dev server — already serves over http://localhost.
      rendererOrigin = originOf(process.env.ELECTRON_RENDERER_URL);
      await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      // Packaged build: serve over http://localhost too (not file://), since
      // Cloudflare Turnstile needs a real hostname to validate against.
      const rendererDir = join(__dirname, '../renderer');
      const { url } = await startLocalServer(rendererDir);
      rendererOrigin = originOf(url);
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
    watcher.start();

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
