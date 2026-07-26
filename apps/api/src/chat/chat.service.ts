import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../attendance/presence.service';
import type { AuthUser } from '../auth/auth-user';

/**
 * Company chat v1 (2026-07-26): ONE general room every staff member is in.
 * Messages persist here for history and are pushed live over the presence
 * socket ('chat:message'). Unread = messages newer than your read pointer.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  /** Chat is internal — clients have the portal, never the company room. */
  private assertStaff(user: AuthUser): void {
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Company chat is internal');
    }
  }

  /** Newest page of history (ascending for display). `before` pages backwards. */
  async list(user: AuthUser, before?: string, limit = 50) {
    this.assertStaff(user);
    const rows = await this.prisma.chatMessage.findMany({
      where: before ? { createdAt: { lt: new Date(before) } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });
    return { items: rows.reverse(), hasMore: rows.length >= Math.min(Math.max(limit, 1), 100) };
  }

  async post(user: AuthUser, body: string) {
    this.assertStaff(user);
    const message = await this.prisma.chatMessage.create({
      data: { body: body.trim(), authorId: user.id },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });
    // Live to every open staff app; senders dedupe by id on their own append.
    this.presence.emitToAll('chat:message', message);
    // Your own message never counts as unread for you.
    await this.markRead(user);
    return message;
  }

  async markRead(user: AuthUser) {
    this.assertStaff(user);
    const lastReadAt = new Date();
    await this.prisma.chatReadState.upsert({
      where: { userId: user.id },
      update: { lastReadAt },
      create: { userId: user.id, lastReadAt },
    });
    return { lastReadAt };
  }

  /**
   * Who is active right now — "active" means checked in for work (an open
   * attendance session), the same definition the rest of the system uses.
   * Open to all staff (unlike /attendance/online, which is HR-scoped and
   * carries emails/teams): the room shows names only.
   */
  async activeNow(user: AuthUser) {
    this.assertStaff(user);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { checkOutAt: null },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { checkInAt: 'asc' },
    });
    // One entry per person even if data ever holds two open sessions.
    const seen = new Set<string>();
    return sessions
      .filter((s) => !seen.has(s.user.id) && seen.add(s.user.id))
      .map((s) => ({ id: s.user.id, name: s.user.name }));
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    this.assertStaff(user);
    const state = await this.prisma.chatReadState.findUnique({
      where: { userId: user.id },
      select: { lastReadAt: true },
    });
    const count = await this.prisma.chatMessage.count({
      where: {
        authorId: { not: user.id },
        ...(state ? { createdAt: { gt: state.lastReadAt } } : {}),
      },
    });
    return { count };
  }
}
