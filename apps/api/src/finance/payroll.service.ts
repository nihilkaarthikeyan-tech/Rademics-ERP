import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { toFinanceConfig } from './finance-config';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const money = (n: number) => Math.round(n * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const isoWeekday = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

export interface PayrollRow {
  employeeCode: string;
  name: string;
  workingDays: number;
  payableDays: number;
  paidLeaveByType: { CASUAL: number; SICK: number; EARNED: number };
  unpaidLeaveDays: number;
  halfDayDeductions: number; // loss-of-pay from the 3-lates rule
  overtimeDays: number;
  remarks: string;
}

/**
 * Payroll EXPORT (Spec §5.8, §21) — not payroll processing. Computes payable days from
 * attendance + approved leave, applies loss-of-pay for unpaid leave and the 3-lates
 * rule, and emits an immutable, revisioned CSV snapshot. Month lock/unlock is
 * Super-Admin-approved and audited (§25).
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ── Month lock state (Spec §5.8, §25) ──
  async getMonth(year: number, month: number) {
    const row = await this.prisma.payrollMonth.findUnique({ where: { year_month: { year, month } } });
    return { year, month, status: row?.status ?? 'OPEN', lockedAt: row?.lockedAt ?? null };
  }

  async isLocked(date: Date): Promise<boolean> {
    const row = await this.prisma.payrollMonth.findUnique({
      where: { year_month: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } },
      select: { status: true },
    });
    return row?.status === 'LOCKED';
  }

  async lock(year: number, month: number, actor: AuthUser, meta: Meta) {
    const row = await this.prisma.payrollMonth.upsert({
      where: { year_month: { year, month } },
      update: { status: 'LOCKED', lockedById: actor.id, lockedAt: new Date() },
      create: { year, month, status: 'LOCKED', lockedById: actor.id, lockedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'PAYROLL_MONTH_LOCKED',
      entityType: 'PayrollMonth', entityId: `${year}-${month}`, after: { status: 'LOCKED' }, ...meta,
    });
    return row;
  }

  async unlock(year: number, month: number, reason: string, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.payrollMonth.findUnique({ where: { year_month: { year, month } } });
    if (existing?.status !== 'LOCKED') throw new BadRequestException('Month is not locked');
    const row = await this.prisma.payrollMonth.update({
      where: { year_month: { year, month } },
      data: { status: 'OPEN', unlockReason: reason.trim() },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'PAYROLL_MONTH_UNLOCKED',
      entityType: 'PayrollMonth', entityId: `${year}-${month}`, after: { reason }, ...meta,
    });
    return row;
  }

  // ── Compute rows from attendance + leave (Spec §21 columns) ──
  async computeRows(year: number, month: number): Promise<PayrollRow[]> {
    const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<string, unknown>;
    const config = toFinanceConfig(rules);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0)); // last day of month

    // Base working days = working weekdays in the month minus holidays.
    const holidays = await this.prisma.holiday.findMany({ where: { date: { gte: monthStart, lte: monthEnd } }, select: { date: true } });
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    let workingDays = 0;
    for (let t = monthStart.getTime(); t <= monthEnd.getTime(); t += 86_400_000) {
      const d = new Date(t);
      if (config.workingDays.includes(isoWeekday(d)) && !holidaySet.has(d.toISOString().slice(0, 10))) workingDays++;
    }

    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', resourceType: 'INTERNAL', role: { not: 'CLIENT' } },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { name: 'asc' },
    });

    const rows: PayrollRow[] = [];
    for (const u of users) {
      const [days, leaves] = await Promise.all([
        this.prisma.attendanceDay.findMany({
          where: { userId: u.id, date: { gte: monthStart, lte: monthEnd } },
          select: { status: true, lateDeductionApplied: true, overtimeSeconds: true },
        }),
        this.prisma.leaveRequest.findMany({
          where: { userId: u.id, status: 'APPROVED', fromDate: { gte: monthStart, lte: monthEnd } },
          select: { type: true, paidDays: true, unpaidDays: true },
        }),
      ]);

      const presentDays = days.reduce((n, d) => n + (d.status === 'PRESENT' ? 1 : d.status === 'HALF_DAY' ? 0.5 : 0), 0);
      const lateDeductionCount = days.filter((d) => d.lateDeductionApplied).length;
      const halfDayDeductions = money(lateDeductionCount * config.threeLatesDeduction.halfDayDeduction);
      const overtimeSeconds = days.reduce((n, d) => n + d.overtimeSeconds, 0);
      const overtimeDays = money(overtimeSeconds / (config.standardWorkdayHours * 3600));

      const paidLeaveByType = { CASUAL: 0, SICK: 0, EARNED: 0 };
      let unpaidLeaveDays = 0;
      for (const lv of leaves) {
        if (lv.type === 'CASUAL' || lv.type === 'SICK' || lv.type === 'EARNED') {
          paidLeaveByType[lv.type] = money(paidLeaveByType[lv.type] + num(lv.paidDays));
        }
        unpaidLeaveDays = money(unpaidLeaveDays + num(lv.unpaidDays));
      }
      const paidLeaveTotal = money(paidLeaveByType.CASUAL + paidLeaveByType.SICK + paidLeaveByType.EARNED);
      const payableDays = money(presentDays + paidLeaveTotal - halfDayDeductions);

      const remarks: string[] = [];
      if (unpaidLeaveDays > 0) remarks.push(`${unpaidLeaveDays} unpaid leave day(s)`);
      if (halfDayDeductions > 0) remarks.push(`${halfDayDeductions} day LOP (3-lates)`);

      rows.push({
        employeeCode: u.employeeCode ?? '',
        name: u.name,
        workingDays,
        payableDays,
        paidLeaveByType,
        unpaidLeaveDays,
        halfDayDeductions,
        overtimeDays,
        remarks: remarks.join('; '),
      });
    }
    return rows;
  }

  /** Documented generic CSV (Spec §21 payroll columns; Tally/Zoho mapping is a config task). */
  toCsv(rows: PayrollRow[]): string {
    const header = [
      'Employee Code', 'Name', 'Working Days', 'Payable Days',
      'Casual (paid)', 'Sick (paid)', 'Earned (paid)',
      'Unpaid Leave Days', 'Half-day Deductions (3-lates)', 'Overtime Days', 'Remarks',
    ];
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [r.employeeCode, r.name, r.workingDays, r.payableDays, r.paidLeaveByType.CASUAL, r.paidLeaveByType.SICK, r.paidLeaveByType.EARNED, r.unpaidLeaveDays, r.halfDayDeductions, r.overtimeDays, r.remarks].map(esc).join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  // ── Export: immutable, revisioned snapshot (Spec §5.8, §25) ──
  async export(year: number, month: number, actor: AuthUser, meta: Meta) {
    const monthState = await this.getMonth(year, month);
    if (monthState.status !== 'LOCKED') {
      throw new ConflictException('Lock the month before running the payroll export');
    }
    const rows = await this.computeRows(year, month);
    const csv = this.toCsv(rows);
    const priorCount = await this.prisma.payrollExport.count({ where: { year, month } });
    const revision = priorCount + 1;

    const snapshot = await this.prisma.payrollExport.create({
      data: { year, month, revision, csv, rows: rows as unknown as Prisma.InputJsonValue, generatedById: actor.id },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'PAYROLL_EXPORTED',
      entityType: 'PayrollExport', entityId: snapshot.id, after: { year, month, revision, employees: rows.length }, ...meta,
    });
    this.logger.log(`Payroll export ${year}-${month} revision ${revision}: ${rows.length} employees`);
    return { id: snapshot.id, year, month, revision, generatedAt: snapshot.generatedAt, rows, csv };
  }

  listExports(year: number, month: number) {
    return this.prisma.payrollExport.findMany({
      where: { year, month },
      orderBy: { revision: 'desc' },
      select: { id: true, revision: true, generatedAt: true, generatedById: true },
    });
  }

  async getExport(id: string) {
    return this.prisma.payrollExport.findUnique({ where: { id } });
  }
}
