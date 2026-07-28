import { ForbiddenException } from '@nestjs/common';
import { Grant } from '@rademics/permissions';
import type { TaskStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CapabilityService } from '../rbac/capability.service';
import type { AttendanceService } from '../attendance/attendance.service';
import { businessDateKey } from '../attendance/attendance-rules';
import type { AuthUser } from '../auth/auth-user';

/**
 * Executes the assistant's tool calls.
 *
 * This file is the security boundary. The model chooses WHICH tool to call; it
 * never chooses whose data comes back. Every handler here re-derives scope from
 * the authenticated caller and applies the same capability checks the REST API
 * does, so a model that asks for "all attendance" gets exactly what that person
 * would get by opening the page themselves — or a refusal it must relay.
 *
 * A refusal is thrown, not silently narrowed: an employee asking who was late
 * should be told they cannot see that, rather than handed a one-row list that
 * reads like a complete answer.
 */

const ALL = 'ALL' as const;
const OPEN_STATUSES: TaskStatus[] = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW'];
const DONE_STATUSES: TaskStatus[] = ['COMPLETED', 'CLOSED', 'CANCELLED'];

export class AiToolRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
    private readonly attendance: AttendanceService,
  ) {}

  async run(name: string, args: Record<string, unknown>, user: AuthUser): Promise<unknown> {
    switch (name) {
      case 'get_overdue_tasks': return this.overdueTasks(user);
      case 'get_my_tasks': return this.myTasks(user);
      case 'get_team_capacity': return this.teamCapacity(user);
      case 'get_my_attendance_today': return this.myAttendance(user);
      case 'get_team_attendance_today': return this.teamAttendance(user);
      case 'get_my_leave': return this.myLeave(user);
      case 'get_pending_approvals': return this.pendingApprovals(user);
      case 'get_projects': return this.projects(user);
      case 'find_people': return this.findPeople(user, typeof args.search === 'string' ? args.search : undefined);
      case 'get_finance_summary': return this.financeSummary(user);
      default: return { error: `Unknown tool ${name}` };
    }
  }

  // ── scope helpers (mirror of the REST services) ───────────────────────────

  private async scopedProjectIds(user: AuthUser): Promise<string[] | typeof ALL> {
    if (['SUPER_ADMIN', 'HR', 'FINANCE'].includes(user.role)) return ALL;
    const teamUsers = await this.teamScopeUserIds(user.id);
    const relevant = [user.id, ...teamUsers];
    const [managed, assigned] = await Promise.all([
      this.prisma.project.findMany({ where: { pmId: user.id }, select: { id: true } }),
      this.prisma.task.findMany({ where: { assigneeId: { in: relevant } }, select: { projectId: true }, distinct: ['projectId'] }),
    ]);
    return [...new Set([...managed.map((p) => p.id), ...assigned.map((t) => t.projectId)])];
  }

  private async teamScopeUserIds(callerId: string): Promise<string[]> {
    const [reports, ledTeams] = await Promise.all([
      this.prisma.user.findMany({ where: { reportingManagerId: callerId }, select: { id: true } }),
      this.prisma.team.findMany({ where: { teamLeadId: callerId }, select: { id: true } }),
    ]);
    const members = ledTeams.length
      ? await this.prisma.user.findMany({ where: { teamId: { in: ledTeams.map((t) => t.id) } }, select: { id: true } })
      : [];
    return [...new Set([...reports, ...members].map((u) => u.id))];
  }

  private projectFilter(scoped: string[] | typeof ALL) {
    return scoped === ALL ? {} : { projectId: { in: scoped } };
  }

  // ── tools ─────────────────────────────────────────────────────────────────

  private async overdueTasks(user: AuthUser) {
    const scoped = await this.scopedProjectIds(user);
    const rows = await this.prisma.task.findMany({
      where: { ...this.projectFilter(scoped), deadline: { lt: new Date() }, status: { notIn: DONE_STATUSES } },
      select: { title: true, deadline: true, project: { select: { name: true } }, assignee: { select: { name: true } } },
      orderBy: { deadline: 'asc' },
      take: 25,
    });
    return {
      count: rows.length,
      tasks: rows.map((t) => ({
        title: t.title,
        project: t.project.name,
        assignee: t.assignee?.name ?? 'unassigned',
        dueDate: t.deadline?.toISOString().slice(0, 10),
        daysLate: t.deadline ? Math.floor((Date.now() - t.deadline.getTime()) / 86_400_000) : null,
      })),
    };
  }

  private async myTasks(user: AuthUser) {
    const rows = await this.prisma.task.findMany({
      where: { assigneeId: user.id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      select: { title: true, status: true, deadline: true, priority: true, project: { select: { name: true } } },
      orderBy: [{ deadline: 'asc' }],
      take: 40,
    });
    return {
      count: rows.length,
      tasks: rows.map((t) => ({
        title: t.title,
        project: t.project.name,
        status: t.status,
        priority: t.priority,
        dueDate: t.deadline?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  private async teamCapacity(user: AuthUser) {
    const scoped = await this.scopedProjectIds(user);
    const ids = scoped === ALL ? undefined : [...new Set([user.id, ...(await this.teamScopeUserIds(user.id))])];
    const people = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TEAM_LEAD'] }, ...(ids ? { id: { in: ids } } : {}) },
      select: {
        name: true,
        assignedTasks: { where: { status: { in: OPEN_STATUSES } }, select: { estimatedHours: true } },
      },
      take: 60,
    });
    const rows = people
      .map((p) => ({
        name: p.name,
        openTasks: p.assignedTasks.length,
        estimatedHours: p.assignedTasks.reduce((n, t) => n + Number(t.estimatedHours ?? 0), 0),
      }))
      .sort((a, b) => a.openTasks - b.openTasks || a.estimatedHours - b.estimatedHours);
    return { people: rows, note: 'Sorted with the least loaded first.' };
  }

  private async myAttendance(user: AuthUser) {
    const today = await this.attendance.today(user);
    const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
    const hrs = (s: number) => Math.round((s / 3600) * 100) / 100;
    return {
      person: me?.name ?? 'you',
      isYou: true,
      date: today.date,
      checkedInNow: today.checkedIn,
      hoursWorkedToday: hrs(today.workedSeconds),
      overtimeHours: hrs(today.overtimeSeconds),
      idleHours: hrs(today.idleSeconds),
      markedLate: today.isLate,
    };
  }

  /**
   * Other people's attendance. Gated on the same capability the Attendance page
   * uses: ALLOW sees everyone, SCOPED sees only their own team, DENY is refused
   * outright rather than quietly answered with the asker's own row.
   */
  private async teamAttendance(user: AuthUser) {
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, 'attendance.team.view');
    if (grant === Grant.DENY) {
      throw new ForbiddenException(
        "You can only see your own attendance. Your team lead or HR can see the team's.",
      );
    }
    let userIds: string[] | undefined;
    if (grant === Grant.SCOPED) {
      userIds = await this.teamScopeUserIds(user.id);
      if (userIds.length === 0) {
        return { note: 'You do not have anyone reporting to you yet, so there is no team attendance to show.', people: [] };
      }
    }

    // Attendance days are keyed by BUSINESS date at UTC midnight. Using local
    // midnight silently read the previous day in IST (00:00 IST = 18:30 UTC the
    // day before), so "who came late today" answered with yesterday's list.
    const rules = await this.attendance.getRules();
    const todayKey = businessDateKey(new Date(), rules.timezone);
    const start = new Date(`${todayKey}T00:00:00.000Z`);
    const days = await this.prisma.attendanceDay.findMany({
      where: { date: start, ...(userIds ? { userId: { in: userIds } } : {}) },
      select: {
        status: true,
        isLate: true,
        workedSeconds: true,
        user: { select: { name: true } },
      },
    });
    const open = await this.prisma.attendanceSession.findMany({
      where: { checkOutAt: null, ...(userIds ? { userId: { in: userIds } } : {}) },
      select: { user: { select: { name: true } } },
    });

    return {
      date: todayKey,
      scope: grant === Grant.SCOPED ? 'your team only' : 'everyone',
      late: days.filter((d) => d.isLate).map((d) => d.user.name),
      absent: days.filter((d) => d.status === 'ABSENT').map((d) => d.user.name),
      present: days.filter((d) => d.status === 'PRESENT').map((d) => d.user.name),
      checkedInRightNow: [...new Set(open.map((s) => s.user.name))],
      note: days.length === 0 ? 'No attendance has been recorded for today yet.' : undefined,
    };
  }

  private async myLeave(user: AuthUser) {
    const [balances, requests] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: { userId: user.id },
        select: { type: true, accruedDays: true, usedDays: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { type: true, fromDate: true, toDate: true, status: true, totalDays: true },
      }),
    ]);
    return {
      balances: balances.map((b) => ({
        type: b.type,
        availableDays: Number(b.accruedDays) - Number(b.usedDays),
        usedDays: Number(b.usedDays),
      })),
      recentRequests: requests.map((r) => ({
        type: r.type,
        from: r.fromDate.toISOString().slice(0, 10),
        to: r.toDate.toISOString().slice(0, 10),
        days: Number(r.totalDays),
        status: r.status,
      })),
      note:
        balances.length === 0
          ? 'No balances have been credited yet — monthly accrual runs on the 1st.'
          : undefined,
    };
  }

  private async pendingApprovals(user: AuthUser) {
    const [leave, regs] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { status: 'PENDING', currentApproverId: user.id },
        select: { user: { select: { name: true } }, type: true, fromDate: true, toDate: true },
        take: 25,
      }),
      this.prisma.regularizationRequest.findMany({
        where: { status: 'PENDING' },
        select: { user: { select: { name: true, reportingManagerId: true } }, date: true, reason: true },
        take: 25,
      }),
    ]);
    // Regularizations route by reporting line; only surface the asker's own.
    const mineRegs = regs.filter((r) => r.user.reportingManagerId === user.id || ['SUPER_ADMIN', 'HR'].includes(user.role));
    return {
      leaveRequests: leave.map((l) => ({
        person: l.user.name,
        type: l.type,
        from: l.fromDate.toISOString().slice(0, 10),
        to: l.toDate.toISOString().slice(0, 10),
      })),
      attendanceCorrections: mineRegs.map((r) => ({
        person: r.user.name,
        date: r.date.toISOString().slice(0, 10),
        reason: r.reason,
      })),
      total: leave.length + mineRegs.length,
    };
  }

  private async projects(user: AuthUser) {
    const scoped = await this.scopedProjectIds(user);
    const rows = await this.prisma.project.findMany({
      where: scoped === ALL ? {} : { id: { in: scoped } },
      select: {
        name: true,
        status: true,
        pm: { select: { name: true } },
        tasks: { select: { status: true } },
      },
      take: 40,
    });
    return {
      count: rows.length,
      projects: rows.map((p) => {
        const done = p.tasks.filter((t) => DONE_STATUSES.includes(t.status)).length;
        return {
          name: p.name,
          status: p.status,
          manager: p.pm?.name ?? 'nobody appointed',
          totalTasks: p.tasks.length,
          completedTasks: done,
          percentComplete: p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0,
        };
      }),
    };
  }

  private async findPeople(user: AuthUser, search?: string) {
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, 'people.directory.view');
    if (grant === Grant.DENY) throw new ForbiddenException('You do not have access to the staff directory.');
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        // Client contacts are not staff. Only whoever administers clients sees them.
        ...(user.role === 'SUPER_ADMIN' ? {} : { role: { not: 'CLIENT' } }),
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      select: { name: true, role: true, team: { select: { name: true } }, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 60,
    });
    return {
      count: rows.length,
      people: rows.map((p) => ({
        name: p.name,
        role: p.role,
        team: p.team?.name ?? null,
        department: p.department?.name ?? null,
      })),
    };
  }

  private async financeSummary(user: AuthUser) {
    // Must be a capability that actually exists — resolveGrant fails closed on
    // an unknown name, so a typo here silently locks out the people who should
    // see this (it denied Super Admin until corrected).
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, 'finance.invoices.create_edit');
    if (grant === Grant.DENY) {
      throw new ForbiddenException('Invoice figures are visible to Finance and admins only.');
    }
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'] } },
      select: { status: true, total: true, amountPaid: true, dueDate: true, clientOrg: { select: { name: true } } },
    });
    const open = invoices.filter((i) => i.status !== 'PAID');
    const outstanding = open.reduce((n, i) => n + (Number(i.total) - Number(i.amountPaid)), 0);
    return {
      outstandingAmount: Math.round(outstanding * 100) / 100,
      currency: 'INR',
      unpaidInvoices: open.length,
      overdueInvoices: invoices.filter((i) => i.status === 'OVERDUE').length,
      paidInvoices: invoices.filter((i) => i.status === 'PAID').length,
      byClient: Object.entries(
        open.reduce<Record<string, number>>((acc, i) => {
          const k = i.clientOrg?.name ?? 'Unassigned';
          acc[k] = (acc[k] ?? 0) + (Number(i.total) - Number(i.amountPaid));
          return acc;
        }, {}),
      ).map(([client, amount]) => ({ client, outstanding: Math.round(amount * 100) / 100 })),
    };
  }
}
