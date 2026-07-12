import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';
import { PRESENCE_ROOM } from './attendance.constants';

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
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (typeof client.handshake.query.token === 'string' ? client.handshake.query.token : undefined);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      await client.join(PRESENCE_ROOM);
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true); // fail closed — invalid/expired token gets no stream
    }
  }
}
