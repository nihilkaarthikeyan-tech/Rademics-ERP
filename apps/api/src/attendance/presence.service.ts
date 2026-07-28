import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { PRESENCE_ROOM, STAFF_ROOM } from './attendance.constants';

/**
 * In-memory presence cache + broadcast helper for the "who's online now" layer
 * (Spec §5.3). "Online" means currently checked-in (an open attendance session),
 * not merely socket-connected. The authoritative list is the DB (AttendanceService
 * .online()); this service pushes real-time deltas to subscribers and is a fast
 * cache. Clients without a working WebSocket fall back to 30s polling (§25).
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private server: Server | null = null;
  private readonly checkedIn = new Set<string>();

  /** The gateway hands us the Socket.IO server once it is initialized. */
  setServer(server: Server): void {
    this.server = server;
  }

  markCheckedIn(userId: string): void {
    this.checkedIn.add(userId);
    this.broadcast(userId, true);
  }

  markCheckedOut(userId: string): void {
    this.checkedIn.delete(userId);
    this.broadcast(userId, false);
  }

  isCheckedIn(userId: string): boolean {
    return this.checkedIn.has(userId);
  }

  /** Push a real-time event to one user's room (Spec §5.12 in-app notifications). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    try {
      this.server.to(`user:${userId}`).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emitToUser failed: ${(err as Error).message}`);
    }
  }

  /**
   * Push to every STAFF socket — company chat, announcements, and the
   * task/leave/attendance/invoice change nudges.
   *
   * Deliberately the staff room and not `server.emit`. This used to broadcast to
   * the whole namespace on the reasoning that only the staff app connects to
   * it; that was an assumption about well-behaved clients, not a control. A
   * client who lifted their own token out of the portal page could open a
   * socket and receive every internal chat message, every announcement, and a
   * change feed covering every project in the company. The gateway now refuses
   * CLIENT handshakes, and this keeps the blast radius correct even if one ever
   * gets through.
   */
  emitToAll(event: string, payload: unknown): void {
    if (!this.server) return;
    try {
      this.server.to(STAFF_ROOM).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emitToAll failed: ${(err as Error).message}`);
    }
  }

  private broadcast(userId: string, online: boolean): void {
    if (!this.server) return; // no subscribers yet — REST/polling still reflects DB truth
    try {
      this.server.to(PRESENCE_ROOM).emit('presence:update', { userId, online, at: new Date().toISOString() });
    } catch (err) {
      this.logger.warn(`presence broadcast failed: ${(err as Error).message}`);
    }
  }
}
