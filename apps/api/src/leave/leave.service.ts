import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Grant } from '@rademics/permissions';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type {
  LeaveApprovalLevel,
  LeaveRequest,
  LeaveType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../rbac/capability.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  countWorkingDays,
  dateKey,
  monthKey,
  parseDateOnly,
  splitPaidUnpaid,
  toLeaveConfig,
  type LeaveConfig,
} from './leave-rules';
import type { CreateHolidayDto, CreateLeaveDto, DecideLeaveDto, LeaveCalendarQuery } from './dto';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const APPROVE_CAPABILITY = 'leave.approve_team';
const ACCRUAL_TYPES: Exclude<LeaveType, 'UNPAID'>[] = ['CASUAL', 'SICK', 'EARNED'];

/**
 * Leave Management (Spec §5.7). Policy-accurate balances with projected accrual, a
 * routed TL→PM→HR approval chain with 48h escalation, excess→unpaid auto-conversion,
 * a team calendar with overlap warnings, and a holiday-recompute refund path.
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Config (Spec §4, never hardcoded) ──
  private async getConfig(): Promise<LeaveConfig> {
    const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<
      string,
      unknown
    >;
    return toLeaveConfig(rules);
  }

  private async holidayKeys(from: Date, to: Date): Promise<Set<string>> {
    const rows = await this.prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true },
    });
    return new Set(rows.map((r) => dateKey(r.date)));
  }

  // ── Balances + projected accrual (Spec §5.7: visible at all times) ──
  async myBalances(userId: string) {
    return this.balancesFor(userId);
  }

  private async balancesFor(userId: string) {
    const year = new Date().getUTCFullYear();
    const config = await this.getConfig();
    const rows = await this.prisma.leaveBalance.findMany({ where: { userId, year } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    const monthsRemaining = 12 - (new Date().getUTCMonth() + 1); // current month already accrued

    return ACCRUAL_TYPES.map((type) => {
      const quota = config.quotas[type];
      const row = byType.get(type);
      const accrued = Number(row?.accruedDays ?? 0);
      const used = Number(row?.usedDays ?? 0);
      const projectedYearEnd = Math.min(
        quota.daysPerYear,
        accrued + quota.accrualPerMonth * Math.max(0, monthsRemaining),
      );
      return {
        type,
        year,
        accruedDays: accrued,
        usedDays: used,
        availableDays: Math.round((accrued - used) * 100) / 100,
        quotaPerYear: quota.daysPerYear,
        accrualPerMonth: quota.accrualPerMonth,
        projectedYearEndAvailable: Math.round((projectedYearEnd - used) * 100) / 100,
      };
    });
  }

  private async availableDays(userId: string, type: LeaveType): Promise<number> {
    if (type === 'UNPAID') return Number.POSITIVE_INFINITY;
    const year = new Date().getUTCFullYear();
    const row = await this.prisma.leaveBalance.findUnique({
      where: { userId_type_year: { userId, type, year } },
    });
    return Number(row?.accruedDays ?? 0) - Number(row?.usedDays ?? 0);
  }

  // ── Request (Spec §5.7, §24) ──
  async create(user: AuthUser, dto: CreateLeaveDto, meta: Meta): Promise<LeaveRequest> {
    const from = parseDateOnly(dto.fromDate);
    const to = parseDateOnly(dto.toDate);
    const half = dto.half ?? 'FULL';
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid dates');
    }
    if (to < from) throw new BadRequestException('End date must be on or after start date');
    if (half !== 'FULL' && dateKey(from) !== dateKey(to)) {
      throw new BadRequestException('A half-day request must be a single day');
    }

    // No self-overlap with an existing pending/approved request (§24).
    const clash = await this.prisma.leaveRequest.findFirst({
      where: {
        userId: user.id,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('This overlaps an existing leave request');

    const config = await this.getConfig();
    const holidays = await this.holidayKeys(from, to);
    const totalDays = countWorkingDays(from, to, half, config.workingDays, holidays);
    if (totalDays <= 0) {
      throw new BadRequestException('The selected dates contain no working days');
    }

    // Excess beyond balance auto-converts to Unpaid (§5.7); split is finalized at approval.
    const available = await this.availableDays(user.id, dto.type);
    const { paidDays, unpaidDays } = splitPaidUnpaid(dto.type, totalDays, available);

    const { level, approverId } = await this.resolveInitialApprover(user.id);

    const request = await this.prisma.leaveRequest.create({
      data: {
        userId: user.id,
        type: dto.type,
        half,
        fromDate: from,
        toDate: to,
        reason: dto.reason.trim(),
        totalDays,
        paidDays,
        unpaidDays,
        currentLevel: level,
        currentApproverId: approverId,
        escalationDueAt: new Date(Date.now() + config.escalationHours * 3600 * 1000),
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'LEAVE_REQUESTED',
      entityType: 'LeaveRequest',
      entityId: request.id,
      after: { type: dto.type, from: dto.fromDate, to: dto.toDate, totalDays, unpaidDays },
      ...meta,
    });

    await this.notifyApprover(request, `${user.email}`);
    return request;
  }

  listMine(userId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Cancel own pending request (Spec §5.7) ──
  async cancel(id: string, user: AuthUser, meta: Meta) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req || req.userId !== user.id) throw new NotFoundException('Leave request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Only a pending request can be cancelled');

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'LEAVE_CANCELLED',
      entityType: 'LeaveRequest',
      entityId: id,
      ...meta,
    });
    return updated;
  }

  // ── Pending requests the caller may approve, each with an overlap warning (§5.7) ──
  async listPending(caller: AuthUser) {
    const grant = await this.capabilities.resolveGrant(caller.role, caller.resourceType, APPROVE_CAPABILITY);
    let where: Prisma.LeaveRequestWhereInput;
    if (grant === Grant.ALLOW) {
      where = { status: 'PENDING' };
    } else if (grant === Grant.SCOPED) {
      const scope = await this.teamScopeUserIds(caller.id);
      where = {
        status: 'PENDING',
        OR: [{ currentApproverId: caller.id }, { userId: { in: scope } }],
      };
    } else {
      return [];
    }

    const items = await this.prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true, teamId: true } } },
    });

    return Promise.all(
      items.map(async (r) => ({
        ...r,
        overlap: await this.overlapWarning(r.user.teamId, r.userId, r.fromDate, r.toDate),
      })),
    );
  }

  // ── Approve / reject, race-safe (Spec §5.7, §25 two-approver race) ──
  async decide(id: string, approve: boolean, dto: DecideLeaveDto, caller: AuthUser, meta: Meta) {
    const req = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Leave request not found');
    if (req.status !== 'PENDING') throw new ConflictException('This request was already actioned');
    await this.assertCanApprove(caller, req);

    // Re-split against the CURRENT balance at approval time (§24 balance check at approval).
    let paidDays = Number(req.paidDays);
    let unpaidDays = Number(req.unpaidDays);
    if (approve) {
      const available = await this.availableDays(req.userId, req.type);
      const split = splitPaidUnpaid(req.type as never, Number(req.totalDays), available);
      paidDays = split.paidDays;
      unpaidDays = split.unpaidDays;
    }

    // Atomic claim: first write wins, a racing approver sees "already actioned" (§25).
    const claim = await this.prisma.leaveRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewerId: caller.id,
        decisionComment: dto.comment?.trim() ?? null,
        decidedAt: new Date(),
        paidDays,
        unpaidDays,
        currentApproverId: null,
      },
    });
    if (claim.count === 0) throw new ConflictException('This request was already actioned');

    if (approve && paidDays > 0 && req.type !== 'UNPAID') {
      await this.applyUsage(req.userId, req.type, paidDays, req.id);
    }

    await this.audit.record({
      actorId: caller.id,
      actorEmail: caller.email,
      action: approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      entityType: 'LeaveRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: approve ? 'APPROVED' : 'REJECTED', paidDays, unpaidDays, comment: dto.comment ?? null },
      ...meta,
    });

    await this.notifications.notify({
      userId: req.userId,
      type: approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      eventGroup: 'leave',
      title: `Your leave request was ${approve ? 'approved' : 'rejected'}`,
      body: `${req.type} · ${dateKey(req.fromDate)} → ${dateKey(req.toDate)}${unpaidDays > 0 ? ` (${unpaidDays} day(s) unpaid)` : ''}`,
      entityType: 'LeaveRequest',
      entityId: req.id,
    });

    return this.prisma.leaveRequest.findUnique({ where: { id } });
  }

  // ── Team leave calendar (Spec §5.7): approved + pending, with overlaps ──
  async teamCalendar(caller: AuthUser, query: LeaveCalendarQuery) {
    const from = query.from ? parseDateOnly(query.from) : startOfMonth(new Date());
    const to = query.to ? parseDateOnly(query.to) : endOfMonth(new Date());

    // leave.calendar.view is ALLOW for every internal role (§3), so scope by role:
    // HR / Super Admin see company-wide; everyone else sees their own team — as a
    // member (own teamId) and, for a TL/PM, the teams/reports they oversee (§5.7).
    let userFilter: Prisma.LeaveRequestWhereInput = {};
    if (caller.role !== 'SUPER_ADMIN' && caller.role !== 'HR') {
      const me = await this.prisma.user.findUnique({ where: { id: caller.id }, select: { teamId: true } });
      const teammates = me?.teamId
        ? await this.prisma.user.findMany({ where: { teamId: me.teamId }, select: { id: true } })
        : [];
      const managed = await this.teamScopeUserIds(caller.id);
      const ids = [...new Set([caller.id, ...teammates.map((u) => u.id), ...managed])];
      userFilter = { userId: { in: ids } };
    }

    const items = await this.prisma.leaveRequest.findMany({
      where: {
        ...userFilter,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      orderBy: { fromDate: 'asc' },
      include: { user: { select: { id: true, name: true, teamId: true } } },
    });

    // Flag overlaps within the same team (Spec §5.7 warning).
    const withOverlap = items.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      teamId: r.user.teamId,
      type: r.type,
      half: r.half,
      fromDate: dateKey(r.fromDate),
      toDate: dateKey(r.toDate),
      status: r.status,
      overlaps: items.some(
        (o) =>
          o.id !== r.id &&
          o.user.teamId &&
          o.user.teamId === r.user.teamId &&
          o.userId !== r.userId &&
          o.fromDate <= r.toDate &&
          o.toDate >= r.fromDate,
      ),
    }));

    return { items: withOverlap, from: dateKey(from), to: dateKey(to) };
  }

  // ── Holidays (Spec §5.13) + refund recompute (Spec §25) ──
  listHolidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async addHoliday(dto: CreateHolidayDto, actor: AuthUser, meta: Meta) {
    const date = parseDateOnly(dto.date);
    const existing = await this.prisma.holiday.findUnique({ where: { date } });
    if (existing) throw new ConflictException('A holiday already exists on that date');

    const holiday = await this.prisma.holiday.create({ data: { date, name: dto.name.trim() } });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'HOLIDAY_ADDED',
      entityType: 'Holiday',
      entityId: holiday.id,
      after: { date: dto.date, name: dto.name },
      ...meta,
    });

    const refunded = await this.recomputeApprovedLeaveForHoliday(date);
    return { holiday, refundedRequests: refunded };
  }

  /**
   * A new holiday landing inside already-approved leave should not consume balance
   * for that day (Spec §25): recompute working days, refund the delta, notify.
   */
  private async recomputeApprovedLeaveForHoliday(date: Date): Promise<number> {
    const affected = await this.prisma.leaveRequest.findMany({
      where: { status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date }, type: { not: 'UNPAID' } },
    });
    const config = await this.getConfig();
    let count = 0;

    for (const req of affected) {
      const holidays = await this.holidayKeys(req.fromDate, req.toDate);
      const newTotal = countWorkingDays(req.fromDate, req.toDate, req.half as never, config.workingDays, holidays);
      const oldPaid = Number(req.paidDays);
      // Refund only the paid portion that shrank.
      const newPaid = Math.max(0, Math.min(oldPaid, newTotal - Number(req.unpaidDays)));
      const refund = Math.round((oldPaid - newPaid) * 100) / 100;
      if (refund <= 0) continue;

      await this.prisma.leaveRequest.update({
        where: { id: req.id },
        data: { totalDays: newTotal, paidDays: newPaid },
      });
      await this.applyUsage(req.userId, req.type, -refund, req.id, 'REFUND', dateKey(date));
      await this.notifications.notify({
        userId: req.userId,
        type: 'LEAVE_REFUNDED',
        eventGroup: 'leave',
        title: 'Leave day refunded (new holiday)',
        body: `${refund} day(s) refunded on your ${req.type} leave — a holiday was declared on ${dateKey(date)}.`,
        entityType: 'LeaveRequest',
        entityId: req.id,
      });
      count++;
    }
    return count;
  }

  // ── Scheduled jobs (Spec §5.7) ──

  /** Monthly accrual (Spec §5.7). Idempotent per period via the ledger unique key. */
  async runAccrual(forDate?: string): Promise<{ credited: number; period: string }> {
    const now = forDate ? parseDateOnly(forDate) : new Date();
    const period = monthKey(now);
    const year = now.getUTCFullYear();
    const config = await this.getConfig();

    // Only active, internal, non-client staff accrue leave (freelancers excluded, §2).
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', resourceType: 'INTERNAL', role: { not: 'CLIENT' } },
      select: { id: true },
    });

    let credited = 0;
    for (const user of users) {
      for (const type of ACCRUAL_TYPES) {
        const perMonth = config.quotas[type].accrualPerMonth;
        if (perMonth <= 0) continue;

        // Idempotency: skip if this month already accrued for this user+type.
        try {
          await this.prisma.leaveLedger.create({
            data: { userId: user.id, type, entryType: 'ACCRUAL', days: perMonth, periodKey: period },
          });
        } catch {
          continue; // unique violation → already accrued this period
        }

        const cap = config.quotas[type].daysPerYear;
        const balance = await this.prisma.leaveBalance.upsert({
          where: { userId_type_year: { userId: user.id, type, year } },
          update: {},
          create: { userId: user.id, type, year, accruedDays: 0, usedDays: 0 },
        });
        const capped = Math.min(cap, Number(balance.accruedDays) + perMonth);
        await this.prisma.leaveBalance.update({
          where: { userId_type_year: { userId: user.id, type, year } },
          data: { accruedDays: capped },
        });
        credited++;
      }
    }
    this.logger.log(`Leave accrual for ${period}: ${credited} balance credits across ${users.length} users`);
    return { credited, period };
  }

  /** 48h escalation sweep (Spec §5.7): bump unactioned requests up one level. */
  async runEscalationSweep(): Promise<{ escalated: number }> {
    const due = await this.prisma.leaveRequest.findMany({
      where: { status: 'PENDING', escalationDueAt: { lte: new Date() } },
    });
    const config = await this.getConfig();
    let escalated = 0;

    for (const req of due) {
      const nextLevel = this.nextLevel(req.currentLevel);
      if (nextLevel === req.currentLevel && req.currentLevel === 'HR') {
        // Already at the top of the chain — keep pending, don't spin.
        await this.prisma.leaveRequest.update({
          where: { id: req.id },
          data: { escalationDueAt: new Date(Date.now() + config.escalationHours * 3600 * 1000) },
        });
        continue;
      }
      const approverId = await this.resolveApproverForLevel(req.userId, nextLevel);
      const previousApproverId = req.currentApproverId;

      await this.prisma.leaveRequest.update({
        where: { id: req.id },
        data: {
          currentLevel: nextLevel,
          currentApproverId: approverId,
          escalatedCount: { increment: 1 },
          escalationDueAt: new Date(Date.now() + config.escalationHours * 3600 * 1000),
        },
      });
      await this.audit.record({
        action: 'LEAVE_ESCALATED',
        entityType: 'LeaveRequest',
        entityId: req.id,
        before: { level: req.currentLevel },
        after: { level: nextLevel },
      });

      // Notify both parties (§5.7): the requester and the new approver.
      await this.notifications.notify({
        userId: req.userId,
        type: 'LEAVE_ESCALATED',
        eventGroup: 'leave',
        title: 'Your leave request was escalated',
        body: `No action in ${config.escalationHours}h — escalated to ${nextLevel.replace('_', ' ')}.`,
        entityType: 'LeaveRequest',
        entityId: req.id,
      });
      await this.notifications.notifyMany([approverId, previousApproverId], {
        type: 'LEAVE_ESCALATED',
        eventGroup: 'leave',
        title: 'A leave request was escalated to you',
        body: `Awaiting approval at ${nextLevel.replace('_', ' ')} level.`,
        entityType: 'LeaveRequest',
        entityId: req.id,
      });
      escalated++;
    }
    if (escalated) this.logger.log(`Leave escalation sweep: ${escalated} request(s) escalated`);
    return { escalated };
  }

  // ── helpers ──

  private async applyUsage(
    userId: string,
    type: LeaveType,
    days: number,
    requestId: string,
    entryType: 'USAGE' | 'REFUND' = 'USAGE',
    periodKey?: string,
  ): Promise<void> {
    const year = new Date().getUTCFullYear();
    await this.prisma.leaveBalance.upsert({
      where: { userId_type_year: { userId, type, year } },
      update: { usedDays: { increment: days } },
      create: { userId, type, year, accruedDays: 0, usedDays: days > 0 ? days : 0 },
    });
    await this.prisma.leaveLedger.create({
      data: { userId, type, entryType, days, requestId, periodKey: periodKey ?? null },
    });
  }

  private async assertCanApprove(caller: AuthUser, req: LeaveRequest): Promise<void> {
    if (req.userId === caller.id) throw new ForbiddenException('You cannot approve your own leave');
    const grant = await this.capabilities.resolveGrant(caller.role, caller.resourceType, APPROVE_CAPABILITY);
    if (grant === Grant.ALLOW) return; // HR / Super Admin approve anything (§5.7)
    if (grant === Grant.SCOPED) {
      if (req.currentApproverId === caller.id) return;
      const scope = await this.teamScopeUserIds(caller.id);
      if (scope.includes(req.userId)) return;
      throw new ForbiddenException('Outside your approval scope');
    }
    throw new ForbiddenException('Not permitted to approve leave');
  }

  /** Initial approver per the §5.7 chain: TL → (TL absent / is TL) PM → (is PM) HR. */
  private async resolveInitialApprover(
    userId: string,
  ): Promise<{ level: LeaveApprovalLevel; approverId: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, team: { select: { teamLeadId: true } } },
    });
    const leadsTeam = (await this.prisma.team.count({ where: { teamLeadId: userId } })) > 0;

    if (user?.role === 'PM') {
      return { level: 'HR', approverId: await this.resolveApproverForLevel(userId, 'HR') };
    }
    const tlId = user?.team?.teamLeadId ?? null;
    if (tlId && tlId !== userId && !leadsTeam) {
      return { level: 'TEAM_LEAD', approverId: tlId };
    }
    // TL absent or requester is a TL → PM level.
    return { level: 'PM', approverId: await this.resolveApproverForLevel(userId, 'PM') };
  }

  private nextLevel(level: LeaveApprovalLevel): LeaveApprovalLevel {
    if (level === 'TEAM_LEAD') return 'PM';
    return 'HR'; // PM → HR; HR stays HR (top of chain)
  }

  private async resolveApproverForLevel(
    userId: string,
    level: LeaveApprovalLevel,
  ): Promise<string | null> {
    if (level === 'TEAM_LEAD') {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { team: { select: { teamLeadId: true } } },
      });
      const tl = u?.team?.teamLeadId ?? null;
      return tl && tl !== userId ? tl : null;
    }
    if (level === 'PM') {
      // Climb the org chart: the requester's manager, else their team lead's manager.
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          reportingManager: { select: { id: true, role: true } },
          team: { select: { teamLead: { select: { reportingManager: { select: { id: true, role: true } } } } } },
        },
      });
      for (const cand of [u?.reportingManager, u?.team?.teamLead?.reportingManager]) {
        if (cand?.role === 'PM' && cand.id !== userId) return cand.id;
      }
      const pm = await this.prisma.user.findFirst({
        where: { role: 'PM', status: 'ACTIVE', id: { not: userId } },
        select: { id: true },
      });
      return pm?.id ?? null;
    }
    // HR: any active HR user; null means the request waits in the HR queue.
    const hr = await this.prisma.user.findFirst({
      where: { role: 'HR', status: 'ACTIVE', id: { not: userId } },
      select: { id: true },
    });
    return hr?.id ?? null;
  }

  /** SCOPED team = direct reports ∪ members of teams the caller leads (Spec §3). */
  private async teamScopeUserIds(callerId: string): Promise<string[]> {
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

  /** Same-team overlapping approved/pending leave (Spec §5.7 approval warning). */
  private async overlapWarning(
    teamId: string | null,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<{ overlaps: boolean; names: string[] }> {
    if (!teamId) return { overlaps: false, names: [] };
    const others = await this.prisma.leaveRequest.findMany({
      where: {
        userId: { not: userId },
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
        user: { teamId },
      },
      select: { user: { select: { name: true } } },
      take: 10,
    });
    return { overlaps: others.length > 0, names: [...new Set(others.map((o) => o.user.name))] };
  }

  private async notifyApprover(req: LeaveRequest, requesterLabel: string): Promise<void> {
    if (!req.currentApproverId) return; // HR queue picks it up — no single addressee
    await this.notifications.notify({
      userId: req.currentApproverId,
      type: 'LEAVE_REQUESTED',
      eventGroup: 'leave',
      title: 'A leave request awaits your approval',
      body: `${requesterLabel} · ${req.type} · ${dateKey(req.fromDate)} → ${dateKey(req.toDate)}`,
      entityType: 'LeaveRequest',
      entityId: req.id,
    });
  }
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
