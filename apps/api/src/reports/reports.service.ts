import { Injectable } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { ReportColumn, ReportData } from './report-export';
import type { AuthUser } from '../auth/auth-user';

const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const isoWeekday = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
const OPEN_STATUSES: TaskStatus[] = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW', 'CLIENT_REVIEW'];

export interface ReportQuery { from?: string; to?: string }

/**
 * Reports (Spec §5.11, §21). Every figure comes from stored/immutable data (attendance
 * days, task status history, invoices). Role-scoped: HR/SA/Finance see all; PM/TL/EMP
 * see their team/own. CSV + PDF exports share these ReportData shapes.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async rules() {
    return { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<string, unknown>;
  }

  // ── Scope: which users / projects this caller may report on ──
  private async scopeUserIds(user: AuthUser): Promise<string[] | 'ALL'> {
    if (['SUPER_ADMIN', 'HR', 'FINANCE'].includes(user.role)) return 'ALL';
    const team = await this.teamScopeUserIds(user.id);
    return [...new Set([user.id, ...team])];
  }
  private async scopeProjectIds(user: AuthUser): Promise<string[] | 'ALL'> {
    if (['SUPER_ADMIN', 'HR', 'FINANCE'].includes(user.role)) return 'ALL';
    const team = await this.teamScopeUserIds(user.id);
    const relevant = [user.id, ...team];
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
    const teamMembers = ledTeams.length
      ? await this.prisma.user.findMany({ where: { teamId: { in: ledTeams.map((t) => t.id) } }, select: { id: true } })
      : [];
    return [...new Set([...reports, ...teamMembers].map((u) => u.id))];
  }

  private range(q: ReportQuery) {
    const from = q.from ? new Date(q.from) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const to = q.to ? new Date(q.to) : new Date();
    return { from, to };
  }

  // ── Capacity view (Spec §5.9) ──
  async capacity(user: AuthUser) {
    const scope = await this.scopeUserIds(user);
    const rules = await this.rules();
    const weekly = (rules.weeklyCapacityHoursInternal as number) ?? 40;
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TEAM_LEAD', 'PM'] }, ...(scope === 'ALL' ? {} : { id: { in: scope } }) },
      select: {
        id: true, name: true, resourceType: true, team: { select: { name: true } },
        assignedTasks: { where: { status: { in: OPEN_STATUSES } }, select: { estimatedHours: true } },
        skills: { select: { skill: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => {
      const openTasks = u.assignedTasks.length;
      const loadHours = round(u.assignedTasks.reduce((n, t) => n + num(t.estimatedHours), 0));
      const ratio = weekly > 0 ? loadHours / weekly : 1;
      const availability = ratio < 0.7 ? 'GREEN' : ratio < 1 ? 'AMBER' : 'RED';
      return {
        userId: u.id, name: u.name, team: u.team?.name ?? null, resourceType: u.resourceType,
        openTasks, loadHours, weeklyCapacity: weekly, utilizationPct: round(ratio * 100),
        availability, skills: u.skills.map((s) => s.skill.name),
      };
    });
  }

  // ── Attendance report (Spec §21) ──
  async attendance(user: AuthUser, q: ReportQuery): Promise<ReportData> {
    const { from, to } = this.range(q);
    const scope = await this.scopeUserIds(user);
    const rules = await this.rules();
    const workday = (rules.standardWorkdayHours as number) ?? 8;

    const workingDays = await this.workingDaysBetween(from, to, rules);
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', resourceType: 'INTERNAL', role: { not: 'CLIENT' }, ...(scope === 'ALL' ? {} : { id: { in: scope } }) },
      select: { id: true, name: true, team: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const rows = [];
    for (const u of users) {
      const [days, leaves, regs] = await Promise.all([
        this.prisma.attendanceDay.findMany({ where: { userId: u.id, date: { gte: from, lte: to } }, select: { status: true, isLate: true, workedSeconds: true, idleSeconds: true, overtimeSeconds: true } }),
        this.prisma.leaveRequest.findMany({ where: { userId: u.id, status: 'APPROVED', fromDate: { gte: from, lte: to } }, select: { type: true, paidDays: true } }),
        this.prisma.regularizationRequest.count({ where: { userId: u.id, status: 'APPROVED', date: { gte: from, lte: to } } }),
      ]);
      const present = days.filter((d) => d.status === 'PRESENT').length;
      const half = days.filter((d) => d.status === 'HALF_DAY').length;
      const absent = days.filter((d) => d.status === 'ABSENT').length;
      const lates = days.filter((d) => d.isLate).length;
      const workedHrs = round(days.reduce((n, d) => n + d.workedSeconds, 0) / 3600);
      const idleHrs = round(days.reduce((n, d) => n + d.idleSeconds, 0) / 3600);
      const overtimeDays = round(days.reduce((n, d) => n + d.overtimeSeconds, 0) / (workday * 3600));
      const idlePct = workedHrs + idleHrs > 0 ? round((idleHrs / (workedHrs + idleHrs)) * 100) : 0;
      const leaveByType: Record<string, number> = {};
      for (const l of leaves) leaveByType[l.type] = round((leaveByType[l.type] ?? 0) + num(l.paidDays));

      rows.push({
        employee: u.name, team: u.team?.name ?? '—', workingDays, present, absent, lateCount: lates, halfDays: half,
        overtimeDays, leaveDays: Object.entries(leaveByType).map(([t, n]) => `${t}:${n}`).join(' ') || '—',
        workedHrs, idleHrs, idlePct, regularizations: regs,
      });
    }
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee' }, { key: 'team', label: 'Team' }, { key: 'workingDays', label: 'Working days' },
      { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'lateCount', label: 'Late count' },
      { key: 'halfDays', label: 'Half-days' }, { key: 'overtimeDays', label: 'Overtime days' }, { key: 'leaveDays', label: 'Leave days' },
      { key: 'workedHrs', label: 'Worked hrs' }, { key: 'idleHrs', label: 'Idle hrs' }, { key: 'idlePct', label: 'Idle %' },
      { key: 'regularizations', label: 'Regularizations' },
    ];
    return { title: 'Attendance Report', columns, rows };
  }

  // ── Productivity report (Spec §21) ──
  async productivity(user: AuthUser, q: ReportQuery): Promise<ReportData> {
    const { from, to } = this.range(q);
    const scope = await this.scopeUserIds(user);
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' }, ...(scope === 'ALL' ? {} : { id: { in: scope } }) },
      select: { id: true, name: true, team: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const rows = [];
    for (const u of users) {
      const completedTasks = await this.prisma.task.findMany({
        where: { assigneeId: u.id, status: { in: ['COMPLETED', 'CLOSED', 'INVOICED'] }, updatedAt: { gte: from, lte: to } },
        select: { id: true, estimatedHours: true, actualHours: true, deadline: true, updatedAt: true, history: { select: { toStatus: true, action: true, createdAt: true } } },
      });
      const count = completedTasks.length;
      const estHrs = round(completedTasks.reduce((n, t) => n + num(t.estimatedHours), 0));
      const actHrs = round(completedTasks.reduce((n, t) => n + num(t.actualHours), 0));
      const accuracy = estHrs > 0 ? round((estHrs / (actHrs || estHrs)) * 100) : 0;
      const sentBack = completedTasks.reduce((n, t) => n + t.history.filter((h) => h.action === 'SEND_BACK').length, 0);
      const onTime = completedTasks.filter((t) => t.deadline && t.updatedAt <= t.deadline).length;
      const onTimePct = count > 0 ? round((onTime / count) * 100) : 0;
      const avgInProgress = round(this.avgStageHours(completedTasks, 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW'));
      const avgInReview = round(this.avgStageHours(completedTasks, 'SUBMITTED_FOR_REVIEW', 'COMPLETED'));

      rows.push({
        employee: u.name, team: u.team?.name ?? '—', tasksCompleted: count, estimatedHrs: estHrs, actualHrs: actHrs,
        estimateAccuracyPct: accuracy, avgInProgressHrs: avgInProgress, avgInReviewHrs: avgInReview, sentBackCount: sentBack, onTimePct,
      });
    }
    const columns: ReportColumn[] = [
      { key: 'employee', label: 'Employee' }, { key: 'team', label: 'Team' }, { key: 'tasksCompleted', label: 'Tasks completed' },
      { key: 'estimatedHrs', label: 'Estimated hrs' }, { key: 'actualHrs', label: 'Actual hrs' }, { key: 'estimateAccuracyPct', label: 'Estimate accuracy %' },
      { key: 'avgInProgressHrs', label: 'Avg In Progress (h)' }, { key: 'avgInReviewHrs', label: 'Avg Review (h)' },
      { key: 'sentBackCount', label: 'Sent-back count' }, { key: 'onTimePct', label: 'On-time %' },
    ];
    return { title: 'Productivity Report', columns, rows };
  }

  private avgStageHours(tasks: { history: { toStatus: string; createdAt: Date }[] }[], enter: string, exit: string): number {
    const spans: number[] = [];
    for (const t of tasks) {
      const sorted = [...t.history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const enterAt = sorted.find((h) => h.toStatus === enter)?.createdAt;
      const exitAt = sorted.find((h) => h.toStatus === exit)?.createdAt;
      if (enterAt && exitAt && exitAt > enterAt) spans.push((exitAt.getTime() - enterAt.getTime()) / 3_600_000);
    }
    return spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0;
  }

  // ── Project status report (Spec §21) ──
  async projectStatus(user: AuthUser): Promise<ReportData> {
    const scope = await this.scopeProjectIds(user);
    const projects = await this.prisma.project.findMany({
      where: scope === 'ALL' ? {} : { id: { in: scope } },
      select: {
        id: true, name: true, type: true, pm: { select: { name: true } }, clientOrg: { select: { name: true } },
        tasks: { where: { parentTaskId: null }, select: { status: true, deadline: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);

    const rows = [];
    for (const p of projects) {
      const total = p.tasks.length;
      const done = p.tasks.filter((t) => ['COMPLETED', 'CLOSED', 'INVOICED'].includes(t.status)).length;
      const overdue = p.tasks.filter((t) => t.deadline && t.deadline < new Date() && !['COMPLETED', 'CLOSED', 'CANCELLED', 'INVOICED'].includes(t.status)).length;
      const pct = total > 0 ? round((done / total) * 100) : 0;
      const recentDone = await this.prisma.taskStatusHistory.count({ where: { task: { projectId: p.id }, toStatus: { in: ['COMPLETED', 'CLOSED'] }, createdAt: { gte: fourWeeksAgo } } });
      const perWeek = round(recentDone / 4, 1);
      const open = total - done;
      const risk = perWeek === 0 && open > 0 ? 'HIGH' : open / (perWeek || 1) <= 2 ? 'LOW' : open / (perWeek || 1) <= 5 ? 'MEDIUM' : 'HIGH';
      const byStatus = p.tasks.reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {});

      rows.push({
        project: p.name, client: p.clientOrg?.name ?? '—', pm: p.pm?.name ?? '—', type: p.type,
        tasksByStatus: Object.entries(byStatus).map(([s, n]) => `${s}:${n}`).join(' ') || '—',
        overdue, pctComplete: pct, throughputPerWeek: perWeek, risk,
      });
    }
    const columns: ReportColumn[] = [
      { key: 'project', label: 'Project' }, { key: 'client', label: 'Client' }, { key: 'pm', label: 'PM' }, { key: 'type', label: 'Type' },
      { key: 'tasksByStatus', label: 'Tasks by status' }, { key: 'overdue', label: 'Overdue' }, { key: 'pctComplete', label: '% complete' },
      { key: 'throughputPerWeek', label: 'Throughput/wk' }, { key: 'risk', label: 'Risk' },
    ];
    return { title: 'Project Status Report', columns, rows };
  }

  async build(type: string, user: AuthUser, q: ReportQuery): Promise<ReportData> {
    switch (type) {
      case 'attendance': return this.attendance(user, q);
      case 'productivity': return this.productivity(user, q);
      case 'project-status': return this.projectStatus(user);
      default: return { title: 'Unknown report', columns: [], rows: [] };
    }
  }

  private async workingDaysBetween(from: Date, to: Date, rules: Record<string, unknown>): Promise<number> {
    const workingDays = (rules.workingDays as number[]) ?? [...DEFAULT_BUSINESS_RULES.workingDays];
    const holidays = await this.prisma.holiday.findMany({ where: { date: { gte: from, lte: to } }, select: { date: true } });
    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    let n = 0;
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
      const d = new Date(t);
      if (workingDays.includes(isoWeekday(d)) && !holidaySet.has(d.toISOString().slice(0, 10))) n++;
    }
    return n;
  }
}
