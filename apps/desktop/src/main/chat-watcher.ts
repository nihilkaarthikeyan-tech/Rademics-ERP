import { Notification } from 'electron';
import { io, type Socket } from 'socket.io-client';
import type { AuthStore } from './auth-store';

interface IncomingMessage {
  id: string;
  roomId?: string;
  body: string;
  author: { id: string; name: string } | null;
  files: unknown[];
}

interface RoomInfo {
  id: string;
  kind: 'COMPANY' | 'GROUP' | 'DIRECT';
  name: string;
}

/**
 * Listens for chat messages while the app sits in the tray, so staff hear
 * about a message even with no browser open: a Windows notification (with the
 * system sound) for each one, and a running unread count for the tray and the
 * app window. Uses the same live channel the website uses — nothing new on the
 * server.
 */
export class ChatWatcher {
  private socket: Socket | null = null;
  private rooms = new Map<string, RoomInfo>();
  private myName: string | null = null;
  private unread = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryDelay = 5_000;

  constructor(
    private readonly auth: AuthStore,
    private readonly socketOrigin: string,
    private readonly opts: {
      /** The chat window is open and in front — no pop-up needed. */
      isChatFocused: () => boolean;
      openChat: (roomId?: string, messageId?: string) => void;
      onUnread: (count: number) => void;
    },
  ) {}

  start(): void {
    this.auth.onChange((state) => (state.authenticated ? this.connect() : this.disconnect()));
    if (this.auth.authenticated) this.connect();
  }

  get unreadCount(): number {
    return this.unread;
  }

  /** Re-read the unread total (after the chat window closes, on a timer, …). */
  async refreshUnread(): Promise<void> {
    if (!this.auth.authenticated) return this.setUnread(0);
    try {
      const r = await this.auth.getJson<{ count: number }>('/chat/unread-count');
      this.setUnread(r.count);
    } catch {
      /* keep the last known count */
    }
  }

  private setUnread(n: number): void {
    if (n === this.unread) return;
    this.unread = n;
    this.opts.onUnread(n);
  }

  private connect(): void {
    if (this.socket) return;
    const socket = io(`${this.socketOrigin}/attendance`, {
      // A function, so every reconnect presents the CURRENT access token.
      auth: (cb) => cb({ token: this.auth.accessToken() ?? '' }),
      transports: ['websocket'],
      reconnectionDelayMax: 30_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.retryDelay = 5_000;
      void this.loadRooms();
      void this.refreshUnread();
    });
    // The server hangs up on an expired token. Renew it, then come back.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') this.scheduleReconnect();
    });
    socket.on('chat:message', (m: IncomingMessage) => void this.onMessage(m));
    socket.on('chat:roomsChanged', () => void this.loadRooms());
    socket.on('chat:messageDeleted', () => void this.refreshUnread());

    // Reading on another device (the website) lowers the count here too.
    this.pollTimer = setInterval(() => void this.refreshUnread(), 60_000);
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (!this.socket || !this.auth.authenticated) return;
      await this.auth.attemptSilentRefresh();
      this.socket.connect();
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    }, this.retryDelay);
  }

  private disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.retryTimer = null;
    this.pollTimer = null;
    this.socket?.close();
    this.socket = null;
    this.rooms.clear();
    this.myName = null;
    this.setUnread(0);
  }

  private async loadRooms(): Promise<void> {
    try {
      const list = await this.auth.getJson<RoomInfo[]>('/chat/rooms');
      this.rooms = new Map(list.map((r) => [r.id, r]));
      if (!this.myName) {
        const me = this.auth.getState().user?.id;
        const people = await this.auth.getJson<{ id: string; name: string }[]>('/chat/members');
        this.myName = people.find((p) => p.id === me)?.name ?? null;
      }
    } catch {
      /* names fall back to generic wording */
    }
  }

  private async onMessage(m: IncomingMessage): Promise<void> {
    const me = this.auth.getState().user?.id;
    if (!m.author || m.author.id === me) return;
    // Let the chat page mark it read first if that room is on screen.
    setTimeout(() => void this.refreshUnread(), 800);
    if (this.opts.isChatFocused()) return;

    if (m.roomId && !this.rooms.has(m.roomId)) await this.loadRooms();
    const room = m.roomId ? this.rooms.get(m.roomId) : undefined;
    const author = m.author.name;
    const mentioned = Boolean(this.myName && m.body.includes(`@${this.myName}`));
    const title = mentioned
      ? `${author} mentioned you${room && room.kind !== 'DIRECT' ? ` in ${room.name}` : ''}`
      : !room || room.kind === 'DIRECT'
        ? author
        : `${author} in ${room.name}`;
    const text = plainText(m.body) || (m.files.length > 0 ? 'Sent a file' : 'New message');

    const note = new Notification({
      title,
      body: text.length > 180 ? `${text.slice(0, 177)}…` : text,
      silent: false,
    });
    note.on('click', () => this.opts.openChat(m.roomId, m.id));
    note.show();
  }
}

/** The message as one plain line: no **, _ or ` formatting markers, list lines joined. */
function plainText(body: string): string {
  return body
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean)
    .join(' · ');
}
