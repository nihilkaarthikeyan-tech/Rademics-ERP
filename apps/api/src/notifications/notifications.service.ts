import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProducer } from '../queue/email.producer';
import { PresenceService } from '../attendance/presence.service';
import { escapeHtml } from '../common/escape-html';

export interface NotifyInput {
  userId: string;
  type: string; // event key, e.g. 'TASK_ASSIGNED'
  eventGroup: string; // preference group, e.g. 'tasks'
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  emailHtml?: string; // when omitted, title/body are used for the email
  /**
   * Force in-app only, ignoring the recipient's preference (2026-07-27).
   *
   * Client/staff correspondence lives in the portals by design — an update, a
   * status request and the 3-day nudge are all read where the work is, not in
   * an inbox. This does NOT apply to account mail (invites, password resets),
   * which is not correspondence and has nowhere else to go.
   */
  channel?: 'IN_APP';
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
    // An explicit IN_APP request wins over the stored preference: these events
    // are meant to be read in the portal, not mailed out.
    const channel = input.channel ?? pref?.pref ?? 'IN_APP_EMAIL'; // default: in-app + email (§5.12)
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
        select: { email: true, role: true },
      });
      /**
       * A client is NEVER emailed from here (2026-07-27). Everything the
       * company says to a client is read in the portal.
       *
       * Enforced structurally rather than by every call site remembering
       * `channel: 'IN_APP'`: this rule has to survive code nobody has written
       * yet, and one forgotten flag on some future notification would silently
       * break a promise made to the client. Account mail — the invite and the
       * password reset — does not pass through here; it is sent directly by
       * AuthService, and without it nobody could reach the portal at all.
       */
      if (user?.email && user.role !== 'CLIENT') {
        await this.email.enqueue({
          to: user.email,
          subject: input.title,
          // Titles and bodies can carry names people typed (file names, task
          // titles), so they're escaped: never markup or links in a company email.
          html:
            input.emailHtml ??
            `<p>${escapeHtml(input.title)}</p>${input.body ? `<p>${escapeHtml(input.body)}</p>` : ''}`,
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

  /**
   * Like notifyMany, but never delivers to nobody.
   *
   * For client-triggered events the natural recipients are the task's assignee
   * and the project's appointed manager — either of which can legitimately be
   * unset. Dropping the event then is the worst outcome available: the client
   * is told "the team has been notified" while nothing reached anyone, and the
   * silence looks identical to being ignored. Falling back to whoever can run
   * any project (Super Admin / HR) keeps the promise true.
   *
   * Returns how many people were actually reached, so callers can log or
   * surface a genuinely undeliverable event rather than assume success.
   */
  async notifyManyOrEscalate(
    userIds: (string | null | undefined)[],
    base: Omit<NotifyInput, 'userId'>,
  ): Promise<{ delivered: number; escalated: boolean }> {
    const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (unique.length > 0) {
      await this.notifyMany(unique, base);
      return { delivered: unique.length, escalated: false };
    }

    const fallback = await this.prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'HR'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    await this.notifyMany(
      fallback.map((u) => u.id),
      // Say why they are seeing it — an unrouted request is itself the signal
      // that the project needs an owner.
      { ...base, body: `${base.body ?? base.title} · nobody is assigned to this yet` },
    );
    return { delivered: fallback.length, escalated: true };
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

  /** Delete one notification — only ever the caller's own (the where-clause is the check). */
  async remove(userId: string, id: string): Promise<{ id: string; deleted: boolean }> {
    const res = await this.prisma.notification.deleteMany({ where: { id, userId } });
    return { id, deleted: res.count > 0 };
  }

  /** Clear the caller's inbox, or only the notifications they have already read. */
  async clear(userId: string, readOnly: boolean): Promise<{ deleted: number }> {
    const res = await this.prisma.notification.deleteMany({
      where: { userId, ...(readOnly ? { readAt: { not: null } } : {}) },
    });
    return { deleted: res.count };
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
