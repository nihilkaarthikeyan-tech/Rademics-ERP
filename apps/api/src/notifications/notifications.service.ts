import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProducer } from '../queue/email.producer';
import { PresenceService } from '../attendance/presence.service';

export interface NotifyInput {
  userId: string;
  type: string; // event key, e.g. 'TASK_ASSIGNED'
  eventGroup: string; // preference group, e.g. 'tasks'
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  emailHtml?: string; // when omitted, title/body are used for the email
}

/**
 * Notifications core (Spec §5.12). Writes an in-app row (delivered real-time via
 * the presence gateway) and — unless the user muted the group — enqueues email on
 * the async queue. Per-user, per-group preference decides the channel. Never throws
 * into the caller's transaction path.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProducer,
    private readonly presence: PresenceService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    if (!input.userId) return; // no recipient (e.g. project has no PM yet) — skip quietly
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_eventGroup: { userId: input.userId, eventGroup: input.eventGroup } },
      select: { pref: true },
    });
    const channel = pref?.pref ?? 'IN_APP_EMAIL'; // default: in-app + email (§5.12)
    if (channel === 'MUTE') return;

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });

    // Real-time in-app delivery.
    this.presence.emitToUser(input.userId, 'notification', {
      id: notification.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdAt: notification.createdAt,
    });

    if (channel === 'IN_APP_EMAIL') {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });
      if (user?.email) {
        await this.email.enqueue({
          to: user.email,
          subject: input.title,
          html: input.emailHtml ?? `<p>${input.title}</p>${input.body ? `<p>${input.body}</p>` : ''}`,
          text: input.body ?? input.title,
        });
      }
    }
  }

  /** Fan out one event to many recipients (dedup + skip empties). */
  async notifyMany(userIds: (string | null | undefined)[], base: Omit<NotifyInput, 'userId'>): Promise<void> {
    const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    await Promise.all(unique.map((userId) => this.notify({ ...base, userId })));
  }

  // ── Read API (§5.12) ──
  list(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, readAt: unreadOnly ? null : undefined },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<{ id: string; readAt: Date }> {
    const readAt = new Date();
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt },
    });
    return { id, readAt };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  // ── Preferences (§5.12) ──
  listPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async setPreference(userId: string, eventGroup: string, pref: 'IN_APP' | 'IN_APP_EMAIL' | 'MUTE') {
    return this.prisma.notificationPreference.upsert({
      where: { userId_eventGroup: { userId, eventGroup } },
      update: { pref },
      create: { userId, eventGroup, pref },
    });
  }
}
