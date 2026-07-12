'use client';

import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';
import { getToken } from './session';

// Socket.IO server origin = API origin without the '/api' REST prefix.
const SOCKET_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

/**
 * Connect to the attendance presence namespace (Spec §12). The handshake carries
 * the same JWT access token as REST; the server fails the connection closed if it
 * is missing/expired. Callers must handle the WebSocket-unavailable case with a
 * polling fallback (§25).
 */
export function connectPresence(): Socket {
  return io(`${SOCKET_ORIGIN}/attendance`, {
    auth: { token: getToken() ?? '' },
    transports: ['websocket'],
    reconnectionAttempts: 3,
  });
}
