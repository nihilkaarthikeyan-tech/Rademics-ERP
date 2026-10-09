import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, Notification, session, shell } from 'electron';
import type { AuthStore } from './auth-store';
import { IpcChannel } from '../shared/ipc';
import { openExternalIfAllowed } from './open-external';
import { originOf } from './url-guard';

const PARTITION = 'persist:rademics-chat';
// What the chat page may ask the browser for: showing notifications and the
// "copy" buttons. Camera, microphone, location, screen capture and the rest are
// refused — the chat has no use for them.
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write']);

/**
 * The chat, inside the desktop app: a window showing the website's own chat
 * screen (one chat to maintain, never two), without the website's menus. It
 * signs in with the app's session — no second login — by asking the main
 * process for the access token instead of using a refresh cookie of its own.
 */
export class ChatWindow {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly webUrl: string,
    private readonly auth: AuthStore,
    private readonly onClosed: () => void,
    // Where chat files live (the file-storage server). Only links to these are
    // downloaded in place; everything else is treated as an outside link.
    private readonly storageOrigins: readonly string[],
  ) {
    const chatSession = session.fromPartition(PARTITION);
    const webOrigin = originOf(webUrl);

    chatSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && originOf(details.requestingUrl) === webOrigin);
    });
    chatSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      return ALLOWED_PERMISSIONS.has(permission) && originOf(requestingOrigin) === webOrigin;
    });

    // Files opened from the chat save straight to the computer's Downloads
    // folder, exactly like a browser download — nothing is kept inside the app.
    chatSession.on('will-download', (_event, item) => {
      const target = freePath(app.getPath('downloads'), item.getFilename());
      item.setSavePath(target);
      item.once('done', (_e, state) => {
        if (state !== 'completed') return;
        const note = new Notification({ title: 'Saved to Downloads', body: basename(target) });
        // Show the file in its folder rather than opening it: a click on a
        // notification must never run a downloaded program.
        note.on('click', () => shell.showItemInFolder(target));
        note.show();
      });
    });

    // The chat page's token source. `get` hands over the current token; `refresh`
    // renews it through the app's own single-flight refresh (no rotation race).
    // Only the staff website itself gets the token — not an outside page that
    // somehow ended up in this window, and not a frame embedded in the chat.
    const fromWebApp = (event: Electron.IpcMainInvokeEvent) =>
      webOrigin !== null && originOf(event.senderFrame?.url) === webOrigin;
    ipcMain.handle(IpcChannel.ChatHostGetToken, (event) => (fromWebApp(event) ? this.auth.accessToken() : null));
    ipcMain.handle(IpcChannel.ChatHostRefreshToken, async (event) => {
      if (!fromWebApp(event)) return null;
      return (await this.auth.attemptSilentRefresh()) ? this.auth.accessToken() : null;
    });

    // Signing out of the app signs the chat out too. The website keeps its
    // session in this window's own storage, so on a shared PC the next person
    // would otherwise open the chat as the previous one.
    auth.onChange((state) => {
      if (state.authenticated) return;
      if (this.win && !this.win.isDestroyed()) this.win.close();
      void chatSession.clearStorageData().catch(() => undefined);
    });
  }

  private badge: { image: Electron.NativeImage | null; label: string } = { image: null, label: '' };

  /** Mirror the unread badge on the chat window's own taskbar button. */
  setBadge(image: Electron.NativeImage | null, label: string): void {
    this.badge = { image, label };
    if (this.win && !this.win.isDestroyed()) this.win.setOverlayIcon(image, label);
  }

  isFocused(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible() && this.win.isFocused());
  }

  open(roomId?: string, messageId?: string): void {
    const query = new URLSearchParams({ embed: 'desktop' });
    if (roomId) query.set('room', roomId);
    if (messageId) query.set('message', messageId);
    const url = `${this.webUrl}/chat?${query.toString()}`;

    if (this.win && !this.win.isDestroyed()) {
      // Already open: jump to the conversation that was asked for.
      if (roomId) void this.win.loadURL(url);
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 1040,
      height: 700,
      minWidth: 420,
      minHeight: 480,
      title: 'Rademics Chat',
      icon: join(__dirname, '../../assets/icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        // Its own storage, separate from the attendance window.
        session: session.fromPartition(PARTITION),
        preload: join(__dirname, '../preload/chat.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win = win;
    win.once('ready-to-show', () => win.setOverlayIcon(this.badge.image, this.badge.label));

    // Anything that is not the chat (a task link, an outside website) opens in
    // the normal browser instead of turning this window into a second ERP.
    const inChat = (target: string) => {
      try {
        const u = new URL(target);
        const base = new URL(this.webUrl);
        return u.origin === base.origin && (u.pathname.startsWith('/chat') || u.pathname.startsWith('/login'));
      } catch {
        return false;
      }
    };
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      // A chat file marked for saving downloads here; viewing one (an image, a
      // PDF) and any other link open in the normal browser.
      // Only our own file storage counts — a "save this" link to any other
      // site is just an outside link.
      if (isAttachmentDownload(target) && this.storageOrigins.includes(originOf(target) ?? '')) {
        win.webContents.downloadURL(target);
      } else {
        openExternalIfAllowed(target);
      }
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      if (!inChat(target)) {
        event.preventDefault();
        openExternalIfAllowed(target);
      }
    });
    // Same rule for a server redirect of the page itself: a hop from the chat to
    // somewhere else leaves this window. (Redirects inside embedded frames are
    // left alone — they never replace the chat.)
    win.webContents.on('will-redirect', (event) => {
      if (event.isMainFrame && !inChat(event.url)) {
        event.preventDefault();
        openExternalIfAllowed(event.url);
      }
    });
    win.on('closed', () => {
      this.win = null;
      this.onClosed();
    });
    win.on('blur', () => this.onClosed());

    void win.loadURL(url);
  }
}

/** A presigned storage link asking the browser to save (not display) the file. */
function isAttachmentDownload(target: string): boolean {
  try {
    const disposition = new URL(target).searchParams.get('response-content-disposition') ?? '';
    return disposition.startsWith('attachment');
  } catch {
    return false;
  }
}

/** "report.pdf", or "report (1).pdf" if that name is already taken — like a browser does. */
function freePath(dir: string, filename: string): string {
  const safe = basename(filename) || 'download';
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let n = 1; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`);
  return candidate;
}
