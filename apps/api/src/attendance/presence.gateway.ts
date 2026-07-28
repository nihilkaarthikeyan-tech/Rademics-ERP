import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';
import { SessionStateService } from '../auth/session-state.service';
import { PresenceService } from './presence.service';
import { PRESENCE_ROOM, STAFF_ROOM } from './attendance.constants';

/**
 * The same origin allowlist REST enforces (main.ts). Read from process.env rather
 * than ConfigService because a decorator is evaluated at class-definition time,
 * long before Nest's injector exists. This used to be `origin: true`, which
 * reflects back whatever Origin header arrives — i.e. no restriction at all.
 * Only the internal app opens a socket; the portal has no socket layer and the
 * desktop agent talks REST only.
 */
const SOCKET_ORIGINS = [
  process.env.INTERNAL_APP_URL ?? 'http://localhost:3000',
  // Dev only, mirroring main.ts: a second staff instance on :3002.
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3002']),
];

/**
 * How often to re-check that still-connected sockets belong to live accounts.
 * A socket is authenticated once at handshake and then stays open for hours, so
 * without this a revoked account keeps its stream until it happens to reconnect.
 */
const REVOCATION_SWEEP_MS = 30_000;

/**
 * Socket.IO real-time layer (Spec §12). Authenticates the handshake with the same
 * short-lived JWT as REST (§5.1), then joins the socket to the presence room and a
 * per-user room so team/user-scoped events can be targeted. WebSocket-unavailable
 * clients degrade to 30s polling of GET /attendance/online (§25).
 */
@WebSocketGateway({
  namespace: '/attendance',
  cors: { origin: SOCKET_ORIGINS, credentials: true },
})
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(PresenceGateway.name);

  /**
   * Every socket that passed the handshake. Tracked here rather than read back
   * off the server because @WebSocketServer() hands a Namespace to a namespaced
   * gateway and a Server otherwise — and the two enumerate their sockets
   * differently. An explicit set is unambiguous either way.
   */
  private readonly authed = new Set<Socket>();
  private sweepTimer: NodeJS.Timeout | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
    private readonly sessions: SessionStateService,
  ) {}

  afterInit(server: Server): void {
    this.presence.setServer(server);
    this.sweepTimer = setInterval(() => void this.sweepRevoked(), REVOCATION_SWEEP_MS);
    this.sweepTimer.unref?.(); // never hold the process open on this alone
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async handleConnection(client: Socket): Promise<void> {
    // Handshake auth only. The query-string fallback put a live bearer token
    // into nginx and Cloudflare access logs on every connection.
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      // A valid token is not the same as belonging here. The portal has no
      // socket layer, so a CLIENT presenting one took their token out of the
      // page deliberately — and every broadcast on this namespace is internal.
      if (payload.role === 'CLIENT') {
        this.logger.warn(`Rejected socket from CLIENT account ${payload.sub}`);
        client.disconnect(true);
        return;
      }

      // Signature valid still does not mean currently entitled: the account may
      // have been deactivated, or its sessions revoked, since this token was
      // minted. REST asks this on every request (JwtAuthGuard); a socket that
      // skipped it was a way to keep a live feed after being cut off.
      const reason = await this.sessions.rejectionReason(payload.sub, payload.iat);
      if (reason) {
        this.logger.warn(`Rejected socket for ${payload.sub}: ${reason}`);
        client.disconnect(true);
        return;
      }

      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.data.iat = payload.iat; // the sweep re-checks against this
      await client.join(PRESENCE_ROOM);
      await client.join(STAFF_ROOM);
      await client.join(`user:${payload.sub}`);
      this.authed.add(client);
    } catch {
      client.disconnect(true); // fail closed — invalid/expired token gets no stream
    }
  }

  handleDisconnect(client: Socket): void {
    this.authed.delete(client);
  }

  /**
   * Chat typing relay (2026-07-27): ephemeral fan-out, nothing stored. The
   * sender's identity comes from the authenticated socket, never the payload —
   * only the display name is client-supplied (cosmetic, length-capped).
   */
  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { name?: unknown } | undefined,
  ): void {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const name = typeof payload?.name === 'string' ? payload.name.slice(0, 80) : '';
    // Staff room, not the whole namespace — chat is internal.
    client.broadcast.to(STAFF_ROOM).emit('chat:typing', { userId, name });
  }

  /**
   * Cut loose any open socket whose account is no longer entitled to it. Reads go
   * through SessionStateService's short-lived cache, so this is a Map lookup per
   * socket in the common case, not a query storm.
   */
  private async sweepRevoked(): Promise<void> {
    for (const socket of [...this.authed]) {
      const userId = socket.data.userId as string | undefined;
      if (!userId) {
        this.drop(socket);
        continue;
      }
      try {
        const reason = await this.sessions.rejectionReason(
          userId,
          socket.data.iat as number | undefined,
        );
        if (reason) {
          this.logger.warn(`Closing socket for ${userId}: ${reason}`);
          socket.emit('session:ended', { reason });
          this.drop(socket);
        }
      } catch (err) {
        // A database blip must not disconnect the company. Leave the socket up
        // and re-check on the next sweep — the REST guard still fails closed.
        this.logger.warn(`Revocation sweep failed for ${userId}: ${(err as Error).message}`);
      }
    }
  }

  private drop(socket: Socket): void {
    this.authed.delete(socket);
    socket.disconnect(true);
  }
}
