import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../attendance/presence.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';

/** Audit metadata shape produced by reqMeta(). */
type Meta = { ip?: string | null; userAgent?: string | null };

/** Company notices (2026-07-26): management writes, all staff read + pin. */
const CAN_POST = ['SUPER_ADMIN', 'HR'];

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    private readonly audit: AuditService,
  ) {}

  /** Notices are internal — the client portal never surfaces them. */
  private assertStaff(user: AuthUser): void {
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Company notices are internal');
    }
  }

  private assertPoster(user: AuthUser): void {
    this.assertStaff(user);
    if (!CAN_POST.includes(user.role)) {
      throw new ForbiddenException('Only Super Admin and HR post company notices');
    }
  }

  private activeStaffCount(): Promise<number> {
    return this.prisma.user.count({ where: { status: 'ACTIVE', role: { not: 'CLIENT' } } });
  }

  /**
   * All notices. Order: anything requiring MY acknowledgment that I haven't
   * given yet floats to the very top (it needs action) — then the viewer's
   * pinned ones, then newest first within each group.
   *
   * Read receipt: viewing this list IS how a "seen" stamp gets recorded — one
   * row per (notice, viewer), created if missing and never touched again, so
   * a later visit can't silently overwrite an earlier acknowledgment.
   */
  async list(user: AuthUser) {
    this.assertStaff(user);
    const rows = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        requiresAck: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
        pins: { where: { userId: user.id }, select: { userId: true } },
        reads: { where: { userId: user.id }, select: { acknowledgedAt: true } },
      },
    });

    if (rows.length > 0) {
      // INSERT-only: skipDuplicates means an existing row (and any
      // acknowledgedAt already on it) is left completely untouched.
      await this.prisma.announcementRead.createMany({
        data: rows.map((r) => ({ announcementId: r.id, userId: user.id })),
        skipDuplicates: true,
      });
    }

    const isManager = CAN_POST.includes(user.role);
    const totalStaff = isManager && rows.some((r) => r.requiresAck) ? await this.activeStaffCount() : 0;

    const shaped = await Promise.all(
      rows.map(async ({ pins, reads, ...a }) => {
        const acknowledgedByMe = reads[0]?.acknowledgedAt != null;
        const base = { ...a, pinnedByMe: pins.length > 0, acknowledgedByMe };
        // Ack stats are a management concern (who hasn't read a critical
        // notice), not something every employee needs to see about everyone.
        if (isManager && a.requiresAck) {
          const acknowledgedCount = await this.prisma.announcementRead.count({
            where: { announcementId: a.id, acknowledgedAt: { not: null } },
          });
          return { ...base, ackStats: { total: totalStaff, acknowledged: acknowledgedCount } };
        }
        return base;
      }),
    );

    return shaped.sort((x, y) => {
      const xUrgent = x.requiresAck && !x.acknowledgedByMe ? 1 : 0;
      const yUrgent = y.requiresAck && !y.acknowledgedByMe ? 1 : 0;
      if (xUrgent !== yUrgent) return yUrgent - xUrgent;
      return Number(y.pinnedByMe) - Number(x.pinnedByMe);
    });
  }

  async create(dto: { title: string; body: string; requiresAck?: boolean }, actor: AuthUser) {
    this.assertPoster(actor);
    const announcement = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        requiresAck: dto.requiresAck ?? false,
        createdById: actor.id,
      },
      select: { id: true, title: true },
    });

    // Anyone with the Notices page open sees it appear without a refresh —
    // same live-push pattern chat uses, just a different event name. The bell
    // notification below is the "I wasn't looking at that page" channel;
    // this one is "I already am".
    this.presence.emitToAll('announcement:posted', { id: announcement.id, title: announcement.title });

    // Everyone on staff hears about a new notice — that is the point of one.
    const staff = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' }, id: { not: actor.id } },
      select: { id: true },
    });
    await this.notifications.notifyMany(
      staff.map((u) => u.id),
      {
        type: 'ANNOUNCEMENT_POSTED',
        eventGroup: 'announcements',
        title: 'New company notice',
        body: announcement.title,
        entityType: 'Announcement',
        entityId: announcement.id,
      },
    );
    return this.list(actor).then((all) => all.find((a) => a.id === announcement.id));
  }

  /** Personal pin: keeps a notice on top of THIS person's list only. */
  async setPin(id: string, user: AuthUser, pinned: boolean) {
    this.assertStaff(user);
    const exists = await this.prisma.announcement.count({ where: { id } });
    if (!exists) throw new NotFoundException('Notice not found');
    if (pinned) {
      await this.prisma.announcementPin.upsert({
        where: { announcementId_userId: { announcementId: id, userId: user.id } },
        update: {},
        create: { announcementId: id, userId: user.id },
      });
    } else {
      await this.prisma.announcementPin.deleteMany({ where: { announcementId: id, userId: user.id } });
    }
    return { id, pinnedByMe: pinned };
  }

  /**
   * Explicit "I've read this" — deliberately a separate action from the
   * passive view-stamp in list(). Only this sets acknowledgedAt, so HR can
   * trust it means the person actually clicked, not just that the page loaded.
   */
  async acknowledge(id: string, user: AuthUser) {
    this.assertStaff(user);
    const exists = await this.prisma.announcement.count({ where: { id } });
    if (!exists) throw new NotFoundException('Notice not found');
    const now = new Date();
    await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      update: { acknowledgedAt: now },
      create: { announcementId: id, userId: user.id, viewedAt: now, acknowledgedAt: now },
    });
    return { id, acknowledgedAt: now };
  }

  /** Who HR/SA still needs to nudge — restricted to management (§ privacy: an
   *  employee's read status toward the rest of the company isn't public). */
  async pendingAcknowledgers(id: string, user: AuthUser) {
    this.assertPoster(user);
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      select: { requiresAck: true },
    });
    if (!announcement) throw new NotFoundException('Notice not found');
    if (!announcement.requiresAck) {
      throw new BadRequestException("This notice doesn't require acknowledgment");
    }
    const staff = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' } },
      select: { id: true, name: true, email: true },
    });
    const acked = await this.prisma.announcementRead.findMany({
      where: { announcementId: id, acknowledgedAt: { not: null } },
      select: { userId: true },
    });
    const ackedIds = new Set(acked.map((a) => a.userId));
    return staff.filter((s) => !ackedIds.has(s.id));
  }

  async remove(id: string, actor: AuthUser, meta: Meta) {
    this.assertPoster(actor);
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
      select: { title: true, body: true, requiresAck: true },
    });
    if (!existing) throw new NotFoundException('Notice not found');
    await this.prisma.announcement.delete({ where: { id } });

    // Removing it doesn't erase the record of it having existed — HR can
    // always see who posted, who removed, and what it said (§10 accountability).
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'ANNOUNCEMENT_DELETED',
      entityType: 'Announcement',
      entityId: id,
      before: existing,
      ...meta,
    });

    // Live: it vanishes from every open Notices page, not just the poster's own.
    this.presence.emitToAll('announcement:removed', { id });
    return { id, deleted: true };
  }
}
