import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannel,
  type AuthState,
  type LoginPayload,
  type LoginResult,
  type RademicsDesktopBridge,
  type SavedLogin,
  type StatusUpdatePayload,
  type UpdateStatus,
} from '../shared/ipc';

const bridge: RademicsDesktopBridge = {
  login: (payload: LoginPayload): Promise<LoginResult> => ipcRenderer.invoke(IpcChannel.AuthLogin, payload),

  logout: (): Promise<void> => ipcRenderer.invoke(IpcChannel.AuthLogout),

  getAuthState: (): Promise<AuthState> => ipcRenderer.invoke(IpcChannel.AuthGetState),

  getSavedLogin: (): Promise<SavedLogin> => ipcRenderer.invoke(IpcChannel.AuthGetSavedLogin),

  onAuthStateChanged: (cb: (state: AuthState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AuthState) => cb(state);
    ipcRenderer.on(IpcChannel.AuthStateChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannel.AuthStateChanged, listener);
  },

  checkIn: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IpcChannel.AttendanceCheckIn),

  checkOut: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IpcChannel.AttendanceCheckOut),

  onStatusUpdated: (cb: (payload: StatusUpdatePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: StatusUpdatePayload) => cb(payload);
    ipcRenderer.on(IpcChannel.StatusUpdated, listener);
    return () => ipcRenderer.removeListener(IpcChannel.StatusUpdated, listener);
  },

  onUpdateStatusChanged: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IpcChannel.UpdateStatusChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannel.UpdateStatusChanged, listener);
  },

  restartToInstallUpdate: (): void => {
    void ipcRenderer.invoke(IpcChannel.UpdateRestartToInstall);
  },
};

contextBridge.exposeInMainWorld('rademicsDesktop', bridge);
