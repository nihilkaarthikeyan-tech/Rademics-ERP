/**
 * IPC contract between the renderer (via preload's contextBridge) and the main
 * process. Kept as plain types/constants with no Node or DOM dependency so it can
 * be imported from both tsconfig.node.json and tsconfig.web.json source trees.
 */

export const IpcChannel = {
  AuthLogin: 'auth:login',
  AuthLogout: 'auth:logout',
  AuthGetState: 'auth:getState',
  AuthStateChanged: 'auth:stateChanged',
  AttendanceCheckIn: 'attendance:checkIn',
  AttendanceCheckOut: 'attendance:checkOut',
  StatusUpdated: 'status:updated',
  UpdateStatusChanged: 'update:statusChanged',
  UpdateRestartToInstall: 'update:restartToInstall',
} as const;

export interface AuthUserPayload {
  id: string;
  email: string;
  role: string;
  resourceType: string;
  desktopCheckInRequired: boolean;
}

export interface AuthState {
  authenticated: boolean;
  user: AuthUserPayload | null;
}

export interface LoginPayload {
  email: string;
  password: string;
  captchaToken: string | null;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export interface TodayStatus {
  date: string;
  checkedIn: boolean;
  openSince: string | null;
  workedSeconds: number;
  overtimeSeconds: number;
  idleSeconds: number;
  isLate: boolean;
  status: string;
}

export interface StatusUpdatePayload {
  status: TodayStatus | null;
  autoCheckedOut: boolean;
}

/**
 * Mirrors electron-updater's event lifecycle. 'downloaded' means a new version is
 * ready and just waiting for a restart to apply — nothing installs while the app
 * is running or without the employee choosing to restart.
 */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
}

/** The API surface the preload script exposes on `window.rademicsDesktop`. */
export interface RademicsDesktopBridge {
  login(payload: LoginPayload): Promise<LoginResult>;
  logout(): Promise<void>;
  getAuthState(): Promise<AuthState>;
  onAuthStateChanged(cb: (state: AuthState) => void): () => void;
  checkIn(): Promise<{ ok: boolean; error?: string }>;
  checkOut(): Promise<{ ok: boolean; error?: string }>;
  onStatusUpdated(cb: (payload: StatusUpdatePayload) => void): () => void;
  onUpdateStatusChanged(cb: (status: UpdateStatus) => void): () => void;
  restartToInstallUpdate(): void;
}
