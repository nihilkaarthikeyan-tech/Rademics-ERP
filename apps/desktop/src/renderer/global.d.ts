import type { RademicsDesktopBridge } from '../shared/ipc';

declare global {
  interface Window {
    rademicsDesktop: RademicsDesktopBridge;
  }
}

export {};
