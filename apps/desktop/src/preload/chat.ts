import { contextBridge, ipcRenderer } from 'electron';

// Literal channel names (they match IpcChannel.ChatHost* in shared/ipc.ts): a
// sandboxed preload cannot load a shared chunk, so this file imports nothing
// the main preload also imports.
const GET_TOKEN = 'chatHost:getToken';
const REFRESH_TOKEN = 'chatHost:refreshToken';

/**
 * The only thing the chat window's web page can reach in the app: the access
 * token. The website's API client uses it in place of its refresh cookie, so the
 * chat opens already signed in as whoever is signed in to the app.
 */
contextBridge.exposeInMainWorld('rademicsHost', {
  kind: 'desktop',
  getToken: (): Promise<string | null> => ipcRenderer.invoke(GET_TOKEN),
  refreshToken: (): Promise<string | null> => ipcRenderer.invoke(REFRESH_TOKEN),
});
