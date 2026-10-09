import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttendanceService } from './attendance.service';
import {
  businessDateKey,
  computeDayMarks,
  endOfLocalDayUtc,
  weekdayOfLocalDate,
  type AttendanceRules,
  type SessionInput,
} from './attendance-rules';
import { isPayrollLocked } from '../common/payroll-lock';

/**
 * Nightly rule computation + auto-close (Spec §5.3, §4). Runs off the queue so it
 * never blocks a request (§11). Idempotent: safe to re-run for a date.
 */
@Injectable()
export class AttendanceComputeService {
  private readonly logger = new Logger(AttendanceComputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
  ) {}

  /** Auto-close any session left open past its own end-of-day (Spec §5.3, §25). */
  async autoCloseStale(now = new Date()): Promise<number> {
    const rules = await this.attendance.getRules();
    const todayKey = businessDateKey(now, rules.timezone);
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkOutAt: null },
      select: { id: true, userId: true, checkInAt: true, lastHeartbeatAt: true },
    });

    let closed = 0;
    for (const s of open) {
      const key = businessDateKey(s.checkInAt, rules.timezone);
      if (key === todayKey) continue; // today's open sessions stay open
      // Close at the LAST REAL ACTIVITY, capped at that day's end (2026-07-24
      // decision, revising the earlier stamp-at-23:59 rule): a forgotten checkout
      // must not manufacture on-paper overtime running to midnight. The untouched
      // tail is neither worked nor idle — it simply isn't part of the session.
      // Mirrors the desktop agent's shutdown reconciliation (close at lastHeartbeatAt).
      const endOfDay = endOfLocalDayUtc(s.checkInAt, rules.timezone);
      const lastActivity = s.lastHeartbeatAt ?? s.checkInAt;
      const closeAt = lastActivity < endOfDay ? lastActivity : endOfDay;
      await this.prisma.attendanceSession.update({
        where: { id: s.id },
        data: { checkOutAt: closeAt, autoClosed: true },
      });
      closed += 1;
    }
    if (closed > 0) {
      await this.audit.record({
        action: 'ATTENDANCE_AUTO_CLOSE',
        entityType: 'AttendanceSession',
        after: { closed },
      });
    }
    return closed;
  }

  /** 'YYYY-MM-DD' keys of every company holiday on the given dates. */
  private async holidayKeysFor(dateKeys: string[]): Promise<Set<string>> {
    if (dateKeys.length === 0) return new Set();
    const rows = await this.prisma.holiday.findMany({
      where: { date: { in: dateKeys.map((k) => new Date(k)) } },
      select: { date: true },
    });
    return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
  }

  /** Compute (upsert) one user's marks for one local date. */
  async computeDay(
    userId: string,
    dateKey: string,
    rules: AttendanceRules,
    holidayKeys?: ReadonlySet<string>,
  ): Promise<void> {
    // A locked payroll month keeps the figures that were paid on.
    if (await isPayrollLocked(this.prisma, new Date(dateKey))) return;
    const sessions = await this.sessionsForDate(userId, dateKey, rules);
    const weekday = weekdayOfLocalDate(dateKey, rules.timezone);
    // Fetched per-call only when the caller has not already done it for a batch.
    const holidays = holidayKeys ?? (await this.holidayKeysFor([dateKey]));
    const marks = computeDayMarks(sessions, rules, weekday, dateKey, holidays);

    // Approved leave is not an absence. The day is only reclassified when the
    // employee genuinely did not work it: someone who checks in anyway on an
    // approved leave day keeps the PRESENT/HALF_DAY mark their sessions earned.
    if (marks.status === 'ABSENT' && (await this.hasApprovedLeave(userId, dateKey))) {
      marks.status = 'ON_LEAVE';
    }

    await this.prisma.attendanceDay.upsert({
      where: { userId_date: { userId, date: new Date(dateKey) } },
      create: {
        userId,
        date: new Date(dateKey),
        workedSeconds: marks.workedSeconds,
        idleSeconds: marks.idleSeconds,
        overtimeSeconds: marks.overtimeSeconds,
        firstCheckInAt: marks.firstCheckInAt,
        isLate: marks.isLate,
        status: marks.status,
      },
      update: {
        workedSeconds: marks.workedSeconds,
        idleSeconds: marks.idleSeconds,
        overtimeSeconds: marks.overtimeSeconds,
        firstCheckInAt: marks.firstCheckInAt,
        isLate: marks.isLate,
        status: marks.status,
        computedAt: new Date(),
      },
    });
  }

  /** Nightly entry point: auto-close, then compute every internal employee's day. */
  async runNightly(forDate?: string): Promise<{ date: string; users: number; autoClosed: number }> {
    const rules = await this.attendance.getRules();
    const autoClosed = await this.autoCloseStale();

    // Default target = the day that just ended in company tz (yesterday).
    const now = new Date();
    const dateKey = forDate ?? businessDateKey(new Date(now.getTime() - 12 * 3600 * 1000), rules.timezone);

    // Internal, active employees only — freelancers are excluded from attendance (Spec §5.2).
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', resourceType: 'INTERNAL', role: { not: 'CLIENT' } },
      select: { id: true },
    });
    const holidayKeys = await this.holidayKeysFor([dateKey]);
    for (const u of users) {
      await this.computeDay(u.id, dateKey, rules, holidayKeys);
    }
    await this.applyThreeLatesRule(dateKey, rules);

    this.logger.log(`Nightly attendance: date=${dateKey} users=${users.length} autoClosed=${autoClosed}`);
    return { date: dateKey, users: users.length, autoClosed };
  }

  /** 3 lates in a month = a half-day deduction (Spec §4). Flags the day it triggers. */
  private async applyThreeLatesRule(dateKey: string, rules: AttendanceRules): Promise<void> {
    const monthStart = new Date(`${dateKey.slice(0, 7)}-01`);
    const late = await this.prisma.attendanceDay.groupBy({
      by: ['userId'],
      where: { isLate: true, date: { gte: monthStart, lte: new Date(dateKey) } },
      _count: { _all: true },
    });
    const threshold = rules.threeLatesDeduction.lateCount;
    for (const row of late) {
      const applies = threshold > 0 && row._count._all > 0 && row._count._all % threshold === 0;
      await this.prisma.attendanceDay.updateMany({
        where: { userId: row.userId, date: new Date(dateKey), isLate: true },
        data: { lateDeductionApplied: applies },
      });
    }
  }

  /**
   * Re-derive one person's "3 lates = half-day" marks for the whole month a date
   * falls in. The nightly rule only ever marks the newest day, so when a
   * correction (or a late leave approval) later removes a late mark, the
   * deduction on that month must be worked out again or payroll keeps it.
   */
  async recomputeLateDeductions(userId: string, dateKey: string, rules: AttendanceRules): Promise<void> {
    if (await isPayrollLocked(this.prisma, new Date(dateKey))) return;
    const monthStart = new Date(`${dateKey.slice(0, 7)}-01`);
    const nextMonth = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const days = await this.prisma.attendanceDay.findMany({
      where: { userId, date: { gte: monthStart, lt: nextMonth } },
      select: { id: true, isLate: true, lateDeductionApplied: true },
      orderBy: { date: 'asc' },
    });
    const threshold = rules.threeLatesDeduction.lateCount;
    let lates = 0;
    for (const d of days) {
      if (d.isLate) lates++;
      const applies = d.isLate && threshold > 0 && lates % threshold === 0;
      if (applies !== d.lateDeductionApplied) {
        await this.prisma.attendanceDay.update({ where: { id: d.id }, data: { lateDeductionApplied: applies } });
      }
    }
  }

  /** True when an APPROVED leave request covers this local date (inclusive range). */
  private async hasApprovedLeave(userId: string, dateKey: string): Promise<boolean> {
    const day = new Date(dateKey);
    const found = await this.prisma.leaveRequest.findFirst({
      where: { userId, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day } },
      select: { id: true },
    });
    return found !== null;
  }

  private async sessionsForDate(
    userId: string,
    dateKey: string,
    rules: AttendanceRules,
  ): Promise<SessionInput[]> {
    // A day's sessions can start slightly before/after local midnight in UTC; fetch a
    // wide window and filter by the session's business date.
    const dayStart = new Date(`${dateKey}T00:00:00Z`);
    const rows = await this.prisma.attendanceSession.findMany({
      where: {
        userId,
        checkInAt: {
          gte: new Date(dayStart.getTime() - 24 * 3600 * 1000),
          lte: new Date(dayStart.getTime() + 48 * 3600 * 1000),
        },
      },
      select: { checkInAt: true, checkOutAt: true, idleSeconds: true },
    });
    return rows
      .filter((r) => businessDateKey(r.checkInAt, rules.timezone) === dateKey)
      .map((r) => ({ checkInAt: r.checkInAt, checkOutAt: r.checkOutAt, idleSeconds: r.idleSeconds }));
  }

}
