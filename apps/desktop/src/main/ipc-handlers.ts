import { ipcMain, type BrowserWindow } from 'electron';
import type { AuthStore } from './auth-store';
import type { StatusPoller } from './status-poller';
import { ApiError } from './api-client';
import { restartToInstallUpdate } from './updater';
import { loadSavedLogin, saveLogin } from './saved-login';
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
}): void {
  const { auth, statusPoller, mainWindow } = opts;

  ipcMain.handle(IpcChannel.AuthLogin, async (_event, payload: LoginPayload): Promise<LoginResult> => {
    try {
      await auth.login(payload.email, payload.password, payload.captchaToken);
      // Remember only after a SUCCESSFUL login (never store a wrong password).
      await saveLogin(payload.email, payload.password, payload.remember ?? true).catch(() => undefined);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IpcChannel.AuthGetSavedLogin, () => loadSavedLogin());

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
      statusPoller.noteManualCheckout(); // suppress the false "auto checked-out" banner
      await statusPoller.tick();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  auth.onChange((state) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IpcChannel.AuthStateChanged, state);
  });

  statusPoller.onUpdate((payload) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IpcChannel.StatusUpdated, payload);
  });

  ipcMain.handle(IpcChannel.UpdateRestartToInstall, () => restartToInstallUpdate());
}
