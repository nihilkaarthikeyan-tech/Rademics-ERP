import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AttendanceSource, Prisma } from '@prisma/client';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PresenceService } from './presence.service';
import {
  businessDateKey,
  computeDayMarks,
  overlapWithShiftWindow,
  zonedParts,
  type AttendanceRules,
  type SessionInput,
} from './attendance-rules';
import type { AuthUser } from '../auth/auth-user';
import type { AttendanceHistoryQuery } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const SESSION_PUBLIC = {
  id: true,
  checkInAt: true,
  checkOutAt: true,
  idleSeconds: true,
  autoClosed: true,
  lastHeartbeatAt: true,
  source: true,
} satisfies Prisma.AttendanceSessionSelect;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly presence: PresenceService,
  ) {}

  /** Attendance-relevant rules from Admin Settings (Spec §4), never hardcoded. */
  async getRules(): Promise<AttendanceRules> {
    const r = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<
      string,
      unknown
    >;
    return {
      workingDays: (r.workingDays as number[]) ?? [1, 2, 3, 4, 5, 6],
      lateThreshold: (r.lateThreshold as string) ?? '09:15',
      workStart: (r.workStart as string) ?? '09:00',
      workEnd: (r.workEnd as string) ?? '18:00',
      halfDayUnderHours: (r.halfDayUnderHours as number) ?? 4,
      overtimeOverHours: (r.overtimeOverHours as number) ?? 9,
      idleMinutes: (r.idleMinutes as number) ?? 2,
      threeLatesDeduction:
        (r.threeLatesDeduction as AttendanceRules['threeLatesDeduction']) ?? {
          lateCount: 3,
          halfDayDeduction: 1,
        },
      timezone: (r.timezone as string) ?? 'Asia/Kolkata',
    };
  }

  // ── Check-in (Spec §5.3, idempotent per §25) ──
  async checkIn(
    user: AuthUser,
    idempotencyKey: string | undefined,
    meta: Meta,
    source: AttendanceSource = AttendanceSource.WEB,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.attendanceSession.findUnique({
        where: { idempotencyKey },
        select: SESSION_PUBLIC,
      });
      if (existing) return existing; // retried request — return the same session
    }

    const open = await this.findOpenSession(user.id);
    if (open) throw new ConflictException('You are already checked in');

    const now = new Date();
    const session = await this.prisma.attendanceSession.create({
      data: {
        userId: user.id,
        checkInAt: now,
        lastHeartbeatAt: now,
        idempotencyKey: idempotencyKey ?? null,
        checkInIp: meta.ip ?? null,
        checkInUserAgent: meta.userAgent ?? null,
        source,
      },
      select: SESSION_PUBLIC,
    });

    this.presence.markCheckedIn(user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ATTENDANCE_CHECK_IN',
      entityType: 'AttendanceSession',
      entityId: session.id,
      ...meta,
    });
    return session;
  }

  // ── Check-out (Spec §5.3) ──
  // `reconcile` = the desktop agent completing a checkout that a prior OS shutdown
  // couldn't send in time. We close the session at its last heartbeat (the last
  // moment the machine was known alive) instead of now, so the powered-off gap
  // isn't wrongly counted as idle/worked.
  async checkOut(user: AuthUser, meta: Meta, reconcile = false) {
    const open = await this.findOpenSession(user.id);
    if (!open) throw new BadRequestException('You are not checked in');

    const now = new Date();
    const rules = await this.getRules();
    const lastAlive = open.lastHeartbeatAt ?? open.checkInAt;
    const checkOutAt = reconcile ? lastAlive : now;
    const idleAdd = reconcile ? 0 : this.idleGap(lastAlive, now, rules);

    const session = await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: {
        checkOutAt,
        idleSeconds: { increment: idleAdd },
        checkOutIp: meta.ip ?? null,
        checkOutUserAgent: meta.userAgent ?? null,
      },
      select: SESSION_PUBLIC,
    });

    // Still checked in elsewhere? (multi-session) Only clear presence if no open session remains.
    if (!(await this.findOpenSession(user.id))) this.presence.markCheckedOut(user.id);
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ATTENDANCE_CHECK_OUT',
      entityType: 'AttendanceSession',
      entityId: session.id,
      ...meta,
    });
    return session;
  }

  // ── Idle heartbeat (Spec §5.3): shown to the employee immediately ──
  async heartbeat(user: AuthUser) {
    const open = await this.findOpenSession(user.id);
    if (!open) throw new BadRequestException('You are not checked in');

    const now = new Date();
    const rules = await this.getRules();
    const idleAdd = this.idleGap(open.lastHeartbeatAt ?? open.checkInAt, now, rules);

    const session = await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { lastHeartbeatAt: now, idleSeconds: { increment: idleAdd } },
      select: SESSION_PUBLIC,
    });
    return { idleSeconds: session.idleSeconds, checkedIn: true };
  }

  // Idle no longer auto-checks-out (Spec §5.3 revised). A silent session stays open —
  // people working outside the ERP tab (VS Code, design tools, calls) must not be
  // signed out. Idle time is still tracked (heartbeat commits each gap; checkout and
  // the nightly end-of-day close finalize it; today() adds the live ongoing gap).

  // ── Today's live status for the check-in card (Spec §17.1) ──
  async today(user: AuthUser) {
    const rules = await this.getRules();
    const now = new Date();
    const todayKey = businessDateKey(now, rules.timezone);

    const recent = await this.prisma.attendanceSession.findMany({
      where: { userId: user.id, checkInAt: { gte: new Date(now.getTime() - 48 * 3600 * 1000) } },
      select: SESSION_PUBLIC,
      orderBy: { checkInAt: 'asc' },
    });
    const sessions = recent.filter((s) => businessDateKey(s.checkInAt, rules.timezone) === todayKey);

    // Treat an open session as running-to-now for the live worked/idle figures. For
    // the open session, add the current silent gap so idle reflects an in-progress
    // idle stretch (otherwise it's only committed on the next heartbeat / checkout).
    const forMarks: SessionInput[] = sessions.map((s) => ({
      checkInAt: s.checkInAt,
      checkOutAt: s.checkOutAt ?? now,
      idleSeconds: s.checkOutAt
        ? s.idleSeconds
        : s.idleSeconds + this.idleGap(s.lastHeartbeatAt ?? s.checkInAt, now, rules),
    }));
    const weekday = zonedParts(now, rules.timezone).weekday;
    const marks = computeDayMarks(forMarks, rules, weekday);
    const openSession = sessions.find((s) => !s.checkOutAt) ?? null;

    return {
      date: todayKey,
      checkedIn: Boolean(openSession),
      openSince: openSession?.checkInAt ?? null,
      workedSeconds: marks.workedSeconds,
      overtimeSeconds: marks.overtimeSeconds,
      idleSeconds: marks.idleSeconds,
      isLate: marks.isLate,
      status: openSession ? 'IN_PROGRESS' : marks.status,
      sessions,
    };
  }

  // ── Own attendance history: computed day marks (Spec §5.3, §19) ──
  async myHistory(user: AuthUser, query: AttendanceHistoryQuery) {
    return this.dayHistory([user.id], query);
  }

  // ── Team attendance (SCOPED §3): caller sees only their scope ──
  async teamHistory(caller: AuthUser, query: AttendanceHistoryQuery) {
    const userIds = await this.teamScopeUserIds(caller.id);
    if (userIds.length === 0) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    return this.dayHistory(userIds, query);
  }

  // ── All attendance (HR / Super Admin) ──
  async allHistory(query: AttendanceHistoryQuery) {
    return this.dayHistory(undefined, query);
  }

  // ── Who's online now (currently checked-in) ──
  async onlineAll() {
    return this.onlineFor(undefined);
  }

  async onlineTeam(caller: AuthUser) {
    const userIds = await this.teamScopeUserIds(caller.id);
    return this.onlineFor(userIds);
  }

  // ── helpers ──
  private findOpenSession(userId: string) {
    return this.prisma.attendanceSession.findFirst({
      where: { userId, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
      select: { id: true, checkInAt: true, lastHeartbeatAt: true },
    });
  }

  /**
   * A silent gap counts as idle once it exceeds the configured threshold (§5.3) —
   * but only the portion INSIDE the official shift window (workStart–workEnd).
   * Early-morning or after-6PM silence is the employee's own time, not idle
   * (2026-07-24 decision; keeps late-stay overtime from doubling as idle).
   */
  private idleGap(since: Date, now: Date, rules: AttendanceRules): number {
    const gapSec = Math.floor((now.getTime() - since.getTime()) / 1000);
    if (gapSec <= rules.idleMinutes * 60) return 0;
    return overlapWithShiftWindow(since, now, rules);
  }

  /** SCOPED team = direct reports ∪ members of teams the caller leads (Spec §3). */
  async teamScopeUserIds(callerId: string): Promise<string[]> {
    const [reports, ledTeams] = await Promise.all([
      this.prisma.user.findMany({ where: { reportingManagerId: callerId }, select: { id: true } }),
      this.prisma.team.findMany({ where: { teamLeadId: callerId }, select: { id: true } }),
    ]);
    const teamMembers = ledTeams.length
      ? await this.prisma.user.findMany({
          where: { teamId: { in: ledTeams.map((t) => t.id) } },
          select: { id: true },
        })
      : [];
    return [...new Set([...reports, ...teamMembers].map((u) => u.id))];
  }

  private async dayHistory(userIds: string[] | undefined, query: AttendanceHistoryQuery) {
    const where: Prisma.AttendanceDayWhereInput = {
      userId: userIds ? { in: userIds } : undefined,
      date:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceDay.findMany({
        where,
        orderBy: [{ date: 'desc' }],
        include: { user: { select: { id: true, name: true, email: true } } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.attendanceDay.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async onlineFor(userIds: string[] | undefined) {
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { checkOutAt: null, userId: userIds ? { in: userIds } : undefined },
      select: {
        checkInAt: true,
        user: { select: { id: true, name: true, email: true, team: { select: { id: true, name: true } } } },
      },
      orderBy: { checkInAt: 'asc' },
    });
    return sessions.map((s) => ({
      userId: s.user.id,
      name: s.user.name,
      email: s.user.email,
      team: s.user.team,
      since: s.checkInAt,
    }));
  }
}
