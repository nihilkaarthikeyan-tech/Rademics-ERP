'use client';

import { io, type Socket } from 'socket.io-client';
import { API_BASE, refreshSession } from './api';
import { getToken } from './session';

// Socket.IO server origin = API origin without the '/api' REST prefix.
const SOCKET_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

/**
 * Connect to the attendance presence namespace (Spec §12). The handshake carries
 * the same JWT access token as REST; the server fails the connection closed if it
 * is missing/expired. Callers must handle the WebSocket-unavailable case with a
 * polling fallback (§25).
 *
 * Access tokens only last 15 minutes, so the token is read fresh on every
 * (re)connect, and when the server turns us away for a stale token — which
 * socket.io never retries on its own — we renew the session and connect again.
 * Without this, live updates silently stopped for good a quarter of an hour in.
 */
export function connectPresence(): Socket {
  const socket = io(`${SOCKET_ORIGIN}/attendance`, {
    auth: (cb) => cb({ token: getToken() ?? '' }),
    transports: ['websocket'],
    // Keep trying for as long as the page is open; network blips heal by themselves.
    reconnectionDelayMax: 30_000,
  });

  let stopped = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  // One pending recovery at a time, backing off when the refresh keeps failing
  // (offline, or the session really is over) so we never hammer the server.
  const recover = () => {
    if (stopped || retry) return;
    const delay = failures <= 1 ? 0 : Math.min(30_000, 1000 * 2 ** (failures - 1));
    retry = setTimeout(async () => {
      retry = undefined;
      if (stopped) return;
      if (await refreshSession()) {
        if (!stopped) socket.connect();
      } else {
        failures++;
        recover();
      }
    }, delay);
  };

  socket.on('connect', () => {
    failures = 0;
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') recover();
  });
  // Rejected at the handshake (expired token): socket.io stops retrying, so we do it.
  socket.on('connect_error', () => {
    if (!socket.active) {
      failures++;
      recover();
    }
  });

  // Closing the socket (a component unmounting) must also cancel a pending recovery,
  // or a reconnect could revive a socket nobody is listening to.
  const disconnect = socket.disconnect.bind(socket);
  socket.disconnect = () => {
    stopped = true;
    clearTimeout(retry);
    return disconnect();
  };
  socket.close = socket.disconnect;

  return socket;
}

/**
 * Run `fn` every time the socket comes back after a drop (not on the first
 * connect), so a screen can refetch whatever it missed while it was offline.
 */
export function onReconnect(socket: Socket, fn: () => void): void {
  let connectedBefore = false;
  socket.on('connect', () => {
    if (connectedBefore) fn();
    connectedBefore = true;
  });
}
