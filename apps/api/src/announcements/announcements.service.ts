import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../attendance/presence.service';
import type { AuthUser } from '../auth/auth-user';

/** Company notices (2026-07-26): management writes, all staff read + pin. */
const CAN_POST = ['SUPER_ADMIN', 'HR'];

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
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

  /** All notices, the viewer's pinned ones first, newest first within each half. */
  async list(user: AuthUser) {
    this.assertStaff(user);
    const rows = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
        pins: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    return rows
      .map(({ pins, ...a }) => ({ ...a, pinnedByMe: pins.length > 0 }))
      .sort((a, b) => Number(b.pinnedByMe) - Number(a.pinnedByMe));
  }

  async create(dto: { title: string; body: string }, actor: AuthUser) {
    this.assertPoster(actor);
    const announcement = await this.prisma.announcement.create({
      data: { title: dto.title.trim(), body: dto.body.trim(), createdById: actor.id },
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

  async remove(id: string, actor: AuthUser) {
    this.assertPoster(actor);
    const exists = await this.prisma.announcement.count({ where: { id } });
    if (!exists) throw new NotFoundException('Notice not found');
    await this.prisma.announcement.delete({ where: { id } });
    // Live: it vanishes from every open Notices page, not just the poster's own.
    this.presence.emitToAll('announcement:removed', { id });
    return { id, deleted: true };
  }
}
