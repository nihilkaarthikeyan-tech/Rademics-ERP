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
      const endOfDay = endOfLocalDayUtc(s.checkInAt, rules.timezone);
      const idleAdd = this.idleGap(s.lastHeartbeatAt ?? s.checkInAt, endOfDay, rules.idleMinutes);
      await this.prisma.attendanceSession.update({
        where: { id: s.id },
        data: { checkOutAt: endOfDay, autoClosed: true, idleSeconds: { increment: idleAdd } },
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

  /** Compute (upsert) one user's marks for one local date. */
  async computeDay(userId: string, dateKey: string, rules: AttendanceRules): Promise<void> {
    const sessions = await this.sessionsForDate(userId, dateKey, rules);
    const weekday = weekdayOfLocalDate(dateKey, rules.timezone);
    const marks = computeDayMarks(sessions, rules, weekday);

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
    for (const u of users) {
      await this.computeDay(u.id, dateKey, rules);
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

  private idleGap(since: Date, until: Date, idleMinutes: number): number {
    const gapSec = Math.floor((until.getTime() - since.getTime()) / 1000);
    return gapSec > idleMinutes * 60 ? gapSec : 0;
  }
}
