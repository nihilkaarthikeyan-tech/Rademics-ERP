import { ipcMain, type BrowserWindow } from 'electron';
import type { AuthStore } from './auth-store';
import type { StatusPoller } from './status-poller';
import { ApiError } from './api-client';
import { IpcChannel, type LoginPayload, type LoginResult } from '../shared/ipc';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export function registerIpcHandlers(opts: {
  auth: AuthStore;
  statusPoller: StatusPoller;
  mainWindow: BrowserWindow;
  turnstileSiteKey: string | null;
}): void {
  const { auth, statusPoller, mainWindow, turnstileSiteKey } = opts;

  ipcMain.handle(IpcChannel.AuthLogin, async (_event, payload: LoginPayload): Promise<LoginResult> => {
    try {
      await auth.login(payload.email, payload.password, payload.captchaToken);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IpcChannel.AuthLogout, async () => {
    await auth.logout();
  });

  ipcMain.handle(IpcChannel.AuthGetState, () => auth.getState());

  ipcMain.handle(IpcChannel.AttendanceCheckIn, async () => {
    try {
      await auth.checkIn();
      await statusPoller.tick();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IpcChannel.AttendanceCheckOut, async () => {
    try {
      await auth.checkOut();
      await statusPoller.tick();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IpcChannel.ConfigGetTurnstileSiteKey, () => turnstileSiteKey);

  auth.onChange((state) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IpcChannel.AuthStateChanged, state);
  });

  statusPoller.onUpdate((payload) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IpcChannel.StatusUpdated, payload);
  });
}
