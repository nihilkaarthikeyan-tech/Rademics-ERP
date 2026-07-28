import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';
import { PRESENCE_ROOM, STAFF_ROOM } from './attendance.constants';

/**
 * Socket.IO real-time layer (Spec §12). Authenticates the handshake with the same
 * short-lived JWT as REST (§5.1), then joins the socket to the presence room and a
 * per-user room so team/user-scoped events can be targeted. WebSocket-unavailable
 * clients degrade to 30s polling of GET /attendance/online (§25).
 */
@WebSocketGateway({
  namespace: '/attendance',
  cors: { origin: true, credentials: true },
})
export class PresenceGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(PresenceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server): void {
    this.presence.setServer(server);
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

      client.data.userId = payload.sub;
      client.data.role = payload.role;
      await client.join(PRESENCE_ROOM);
      await client.join(STAFF_ROOM);
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true); // fail closed — invalid/expired token gets no stream
    }
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
}
