import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AttendanceService } from '../attendance/attendance.service';
import { AiGatewayService, AiUnavailableError } from './ai-gateway.service';
import type { AuthUser } from '../auth/auth-user';

interface Meta { ip?: string | null; userAgent?: string | null }

const ALL_PROJECTS = 'ALL' as const;
const OPEN_STATUSES: TaskStatus[] = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW', 'CLIENT_REVIEW'];

/**
 * The four AI features (Spec §7) behind the provider-agnostic gateway. Every feature
 * has a deterministic rule-based path so it still returns useful output with no key
 * (§25 graceful degradation); the gateway adds narrative on top when available. All
 * retrieval is scoped to what the asking user may see — the AI can never surface data
 * the user couldn't open themselves. Each call is counted against the daily limit (§10).
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly attendance: AttendanceService,
    private readonly gateway: AiGatewayService,
  ) {}

  // ── Rate limit (Spec §7, §10): per-user daily counter ──
  private async enforceRateLimit(user: AuthUser): Promise<void> {
    const limit = (await this.gateway.getConfig()).dailyLimitPerUser;
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    const usage = await this.prisma.aiUsage.upsert({
      where: { userId_date: { userId: user.id, date } },
      update: { count: { increment: 1 } },
      create: { userId: user.id, date, count: 1 },
    });
    if (usage.count > limit) {
      throw new HttpException(`Daily AI limit of ${limit} reached`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ── Scope helpers (respect the permission matrix) ──
  private async scopedProjectIds(user: AuthUser): Promise<string[] | typeof ALL_PROJECTS> {
    if (['SUPER_ADMIN', 'HR', 'FINANCE'].includes(user.role)) return ALL_PROJECTS; // projects.view_all
    const teamUsers = await this.teamScopeUserIds(user.id);
    const relevantAssignees = [user.id, ...teamUsers];
    const [managed, assigned] = await Promise.all([
      this.prisma.project.findMany({ where: { pmId: user.id }, select: { id: true } }),
      this.prisma.task.findMany({ where: { assigneeId: { in: relevantAssignees } }, select: { projectId: true }, distinct: ['projectId'] }),
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

  private projectWhere(scoped: string[] | typeof ALL_PROJECTS) {
    return scoped === ALL_PROJECTS ? {} : { id: { in: scoped } };
  }
  private inScope(scoped: string[] | typeof ALL_PROJECTS, projectId: string): boolean {
    return scoped === ALL_PROJECTS || scoped.includes(projectId);
  }

  private label(text: string, aiGenerated: boolean): { text: string; aiGenerated: boolean; disclaimer: string } {
    return { text, aiGenerated, disclaimer: 'AI-generated — verify important details.' };
  }

  /** On-topic (ERP_TERMS) but no dedicated retrieval exists yet — see chat()'s note. */
  private looksUnsupported(q: string): boolean {
    const NO_HANDLER_YET = [
      'leave', 'invoice', 'payment', 'expense',
      'budget', 'p&l', 'employee', 'freelanc', 'milestone', 'deliverable',
    ];
    const hasTaskContext = q.includes('task') || q.includes('project') || q.includes('module');
    return !hasTaskContext && NO_HANDLER_YET.some((t) => q.includes(t));
  }

  private isAttendanceQuestion(q: string): boolean {
    // 'attend' (not the full word 'attendance') so common typos like "attendace"/
    // "attendence" still match — confirmed real user input, not hypothetical.
    return [
      'attend', 'checked in', 'check in', 'checked out', 'check out', 'present',
      'absent', 'am i late', 'late today', 'overtime', 'idle time', 'worked today',
      'clock in', 'clock out',
    ].some((t) => q.includes(t));
  }

  // ── Feature 1: Daily summary, generated once per team per day (Spec §7) ──
  async dailySummary(teamId: string, user: AuthUser, meta: Meta) {
    // Scope: caller must be able to see this team (SA/HR, or the team's lead/manager).
    const scoped = await this.scopedProjectIds(user);
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, teamLeadId: true, members: { select: { id: true, name: true } } },
    });
    if (!team) throw new ForbiddenException('Team not found or out of scope');
    const isManager = ['SUPER_ADMIN', 'HR'].includes(user.role) || team.teamLeadId === user.id;
    if (!isManager) throw new ForbiddenException('Out of scope for this team');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const cached = await this.prisma.aiDailySummary.findUnique({ where: { teamId_date: { teamId, date: today } } });
    if (cached) return { ...this.label(cached.content, cached.aiGenerated), cached: true, date: today };

    await this.enforceRateLimit(user); // only a fresh generation counts against the limit
    const memberIds = team.members.map((m) => m.id);
    const start = today;
    const [history, attendance] = await Promise.all([
      this.prisma.taskStatusHistory.findMany({
        where: { actorId: { in: memberIds }, createdAt: { gte: start } },
        select: { toStatus: true, actor: { select: { name: true } }, task: { select: { title: true } } },
      }),
      this.prisma.attendanceDay.findMany({
        where: { userId: { in: memberIds }, date: start },
        select: { user: { select: { name: true } }, status: true, isLate: true },
      }),
    ]);

    const completed = history.filter((h) => h.toStatus === 'COMPLETED' || h.toStatus === 'CLOSED');
    const inReview = history.filter((h) => h.toStatus === 'SUBMITTED_FOR_REVIEW');
    const late = attendance.filter((a) => a.isLate).map((a) => a.user.name);
    const absent = attendance.filter((a) => a.status === 'ABSENT').map((a) => a.user.name);

    const facts = [
      `Team: ${team.name} (${team.members.length} members).`,
      `Completed today: ${completed.length ? completed.map((h) => `${h.actor?.name} → ${h.task.title}`).join('; ') : 'none'}.`,
      `Submitted for review: ${inReview.length ? inReview.map((h) => h.task.title).join('; ') : 'none'}.`,
      `Attendance anomalies: ${late.length ? `late: ${[...new Set(late)].join(', ')}. ` : ''}${absent.length ? `absent: ${[...new Set(absent)].join(', ')}.` : ''}${!late.length && !absent.length ? 'none.' : ''}`,
    ].join('\n');

    let content = facts;
    let aiGenerated = false;
    try {
      content = await this.gateway.complete(
        'daily_summary',
        'You are an EOD summarizer for an agency. Given the facts, write a concise 3-4 line manager summary of what the team completed, what is in progress/blocked, and any attendance anomalies. Do not invent data.',
        facts,
      );
      aiGenerated = true;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
    }

    await this.prisma.aiDailySummary.create({
      data: { teamId, date: today, content, aiGenerated, provider: aiGenerated ? 'configured' : null, generatedById: user.id },
    });
    await this.audit.record({ actorId: user.id, actorEmail: user.email, action: 'AI_DAILY_SUMMARY', entityType: 'Team', entityId: teamId, ...meta });
    return { ...this.label(content, aiGenerated), cached: false, date: today };
  }

  // ── Feature 2: Completion forecast — rule-based baseline + AI narrative (Spec §7) ──
  async completionForecast(projectId: string, user: AuthUser) {
    await this.enforceRateLimit(user);
    const scoped = await this.scopedProjectIds(user);
    if (!this.inScope(scoped, projectId)) throw new ForbiddenException('Project out of scope');
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) throw new ForbiddenException('Project not found');

    const tasks = await this.prisma.task.findMany({
      where: { projectId, parentTaskId: null },
      select: { status: true, estimatedHours: true },
    });
    const openTasks = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
    const openEstimateHours = openTasks.reduce((n, t) => n + Number(t.estimatedHours ?? 0), 0);

    // Velocity: completions in the last 4 weeks from immutable history.
    const fourWeeksAgo = new Date(Date.now() - 28 * 86_400_000);
    const recentDone = await this.prisma.taskStatusHistory.count({
      where: { task: { projectId }, toStatus: { in: ['COMPLETED', 'CLOSED'] }, createdAt: { gte: fourWeeksAgo } },
    });
    const perWeek = recentDone / 4;
    const weeksToFinish = perWeek > 0 ? Math.ceil(openTasks.length / perWeek) : null;
    const forecastDate = weeksToFinish !== null ? new Date(Date.now() + weeksToFinish * 7 * 86_400_000) : null;

    // Bottleneck: which stage holds the most open tasks.
    const inReview = openTasks.filter((t) => t.status === 'SUBMITTED_FOR_REVIEW' || t.status === 'CLIENT_REVIEW').length;
    const bottleneck = inReview > openTasks.length / 2 ? 'review stage' : 'execution stage';
    const risk = weeksToFinish === null ? 'HIGH' : weeksToFinish <= 2 ? 'LOW' : weeksToFinish <= 5 ? 'MEDIUM' : 'HIGH';
    const reasons = [
      `${openTasks.length} open task(s), ~${openEstimateHours}h estimated`,
      perWeek > 0 ? `throughput ~${perWeek.toFixed(1)} tasks/week` : 'no completions in the last 4 weeks',
      `bottleneck: ${bottleneck}`,
    ];

    const baseline = { projectName: project.name, openTasks: openTasks.length, openEstimateHours, perWeek: Math.round(perWeek * 10) / 10, forecastDate, risk, reasons };

    let narrative = `Forecast for ${project.name}: ${risk} risk. ${reasons.join('; ')}.` + (forecastDate ? ` Estimated completion ~${forecastDate.toISOString().slice(0, 10)}.` : ' Completion date cannot be estimated (no recent throughput).');
    let aiGenerated = false;
    try {
      narrative = await this.gateway.complete(
        'completion_forecast',
        'You are a delivery risk analyst. Given the baseline metrics, write a 2-3 sentence narrative on completion risk and the bottleneck. Do not invent data.',
        JSON.stringify(baseline),
      );
      aiGenerated = true;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
    }

    return { baseline, ...this.label(narrative, aiGenerated) };
  }

  // ── Feature 3: Assignment suggestion — skill match + load (Spec §7, always a suggestion) ──
  async assignmentSuggestion(input: { title?: string; skillIds?: string[] }, user: AuthUser) {
    await this.enforceRateLimit(user);
    const scoped = await this.scopedProjectIds(user);
    const teamUserIds = await this.teamScopeUserIds(user.id);
    const candidateIds = scoped === ALL_PROJECTS ? undefined : [...new Set([user.id, ...teamUserIds])];

    const candidates = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { in: ['EMPLOYEE', 'TEAM_LEAD'] },
        ...(candidateIds ? { id: { in: candidateIds } } : {}),
      },
      select: {
        id: true, name: true, resourceType: true,
        skills: { select: { skillId: true, skill: { select: { name: true } } } },
        assignedTasks: { where: { status: { in: OPEN_STATUSES } }, select: { estimatedHours: true } },
      },
      take: 100,
    });

    const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<string, unknown>;
    const weeklyCapacity = (rules.weeklyCapacityHoursInternal as number) ?? 40;
    const wantSkills = new Set(input.skillIds ?? []);

    const ranked = candidates.map((c) => {
      const openCount = c.assignedTasks.length;
      const loadHours = c.assignedTasks.reduce((n, t) => n + Number(t.estimatedHours ?? 0), 0);
      const skillMatches = c.skills.filter((s) => wantSkills.has(s.skillId)).length;
      const loadRatio = weeklyCapacity > 0 ? loadHours / weeklyCapacity : 1;
      const availability = loadRatio < 0.7 ? 'GREEN' : loadRatio < 1 ? 'AMBER' : 'RED';
      // Score: skill match dominates, then free capacity.
      const score = skillMatches * 10 + Math.max(0, weeklyCapacity - loadHours) / 10;
      return { userId: c.id, name: c.name, openTasks: openCount, loadHours, skillMatches, availability, score: Math.round(score * 100) / 100 };
    }).sort((a, b) => b.score - a.score);

    return { suggestions: ranked.slice(0, 5), note: 'AI-assisted suggestion — the assigner makes the final call.' };
  }

  // ── Feature 4: Scoped chat assistant — read-only, cited, refuses out-of-scope (Spec §7) ──
  async chat(question: string, user: AuthUser, meta: Meta) {
    await this.enforceRateLimit(user);
    const q = question.toLowerCase().trim();

    // Greetings/small-talk get a friendly orientation, not a refusal (or worse,
    // a validation error) — first impressions decide whether people use this at all.
    const GREETINGS = ['hi', 'hello', 'hey', 'hai', 'yo', 'hlo', 'good morning', 'good afternoon', 'good evening', 'thanks', 'thank you', 'ok', 'okay'];
    if (GREETINGS.some((g) => q === g || q === `${g}!` || q === `${g}?` || q.startsWith(`${g} `))) {
      return this.label(
        'Hi! I can help with your work here — try "what\'s my attendance today?", "how many open tasks do I have?", "what\'s overdue?", or "who is free this week?".',
        false,
      );
    }

    const scoped = await this.scopedProjectIds(user);

    // Refuse if the question names a project the user cannot see (§7 no leakage).
    const allProjects = await this.prisma.project.findMany({ select: { id: true, name: true } });
    const named = allProjects.filter((p) => p.name.length > 2 && q.includes(p.name.toLowerCase()));
    const outOfScope = named.find((p) => !this.inScope(scoped, p.id));
    if (outOfScope) {
      return this.label(`I can't answer that — "${outOfScope.name}" is outside your access. You can only ask about projects, tasks, and people within your scope.`, false);
    }

    // On-topic guard (Spec §7): this is a Rademics ERP assistant, not a general chatbot.
    // Unless the question touches a known ERP concept (or names a project the user can
    // see), refuse — no weather, trivia, or other off-topic answers.
    const ERP_TERMS = [
      'task', 'subtask', 'project', 'module', 'overdue', 'deadline', 'due', 'assign',
      'workload', 'capacity', 'free', 'availab', 'busy', 'load', 'team', 'attend',
      'present', 'absent', 'leave', 'invoice', 'payment', 'expense', 'budget', 'p&l',
      'client', 'report', 'employee', 'freelanc', 'milestone', 'review', 'submit',
      'progress', 'status', 'pending', 'hour', 'estimate', 'deliverable', 'work',
      'check', 'clock', 'overtime', 'idle',
    ];
    const onTopic = named.length > 0 || ERP_TERMS.some((t) => q.includes(t));
    if (!onTopic) {
      return this.label(
        'I can only help with Rademics ERP — your projects, tasks, team, attendance, leave, and finance, scoped to what you can access. Try: "what\'s overdue?", "who is free this week?", or "how many open tasks do I have?".',
        false,
      );
    }

    const targetProjectIds = named.length ? named.map((p) => p.id).filter((id) => this.inScope(scoped, id)) : undefined;
    const projectFilter = targetProjectIds ? { projectId: { in: targetProjectIds } } : (scoped === ALL_PROJECTS ? {} : { projectId: { in: scoped } });

    const citations: string[] = [];
    let answer: string;

    if (q.includes('overdue')) {
      const overdue = await this.prisma.task.findMany({
        where: { ...projectFilter, deadline: { lt: new Date() }, status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED', 'INVOICED'] } },
        select: { id: true, title: true, deadline: true, project: { select: { name: true } } },
        take: 20,
      });
      overdue.forEach((t) => citations.push(`Task ${t.title} (${t.project.name})`));
      answer = overdue.length
        ? `There are ${overdue.length} overdue task(s): ${overdue.map((t) => `"${t.title}" in ${t.project.name} (due ${t.deadline?.toISOString().slice(0, 10)})`).join('; ')}.`
        : 'Nothing is overdue in your scope right now.';
    } else if (q.includes('free') || q.includes('capacity') || q.includes('available') || q.includes('who is')) {
      const teamUserIds = await this.teamScopeUserIds(user.id);
      const ids = scoped === ALL_PROJECTS ? undefined : [...new Set([user.id, ...teamUserIds])];
      const people = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TEAM_LEAD'] }, ...(ids ? { id: { in: ids } } : {}) },
        select: { name: true, assignedTasks: { where: { status: { in: OPEN_STATUSES } }, select: { estimatedHours: true } } },
        take: 30,
      });
      const rows = people.map((p) => ({ name: p.name, load: p.assignedTasks.reduce((n, t) => n + Number(t.estimatedHours ?? 0), 0), open: p.assignedTasks.length }));
      rows.sort((a, b) => a.load - b.load);
      rows.forEach((r) => citations.push(`Capacity: ${r.name}`));
      answer = rows.length
        ? `By current load: ${rows.map((r) => `${r.name} (${r.open} open, ~${r.load}h)`).join('; ')}. Lowest load first.`
        : 'No team members are in your scope.';
    } else if (this.isAttendanceQuestion(q)) {
      // Personal, account-level: always the caller's own record (§7 no leakage — this
      // never accepts a target user, so it can't be used to read someone else's attendance).
      const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<string, unknown>;
      const timezone = (rules.timezone as string) ?? 'Asia/Kolkata';
      const todayStatus = await this.attendance.today(user);
      const fmtHours = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.round((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
      };
      citations.push(`Attendance: ${user.email} — ${todayStatus.date}`);
      const parts: string[] = [
        todayStatus.checkedIn
          ? `You're checked in since ${todayStatus.openSince!.toLocaleTimeString('en-IN', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })}.`
          : 'You are checked out right now.',
        `Worked today: ${fmtHours(todayStatus.workedSeconds)}.`,
      ];
      if (todayStatus.overtimeSeconds > 0) parts.push(`Overtime: ${fmtHours(todayStatus.overtimeSeconds)}.`);
      if (todayStatus.idleSeconds > 0) parts.push(`Idle: ${fmtHours(todayStatus.idleSeconds)}.`);
      if (todayStatus.isLate) parts.push('Marked late today.');
      answer = parts.join(' ');
    } else if (this.looksUnsupported(q)) {
      // ERP_TERMS accepts leave/attendance/finance/employee words as "on-topic" so the
      // assistant doesn't wrongly refuse them, but there's no real retrieval for those
      // yet — falling into the task-count answer below used to silently answer the
      // wrong question (confirmed bug, 2026-07-24: "what's my leave balance" returned
      // an unrelated task count). Be honest instead of confidently wrong.
      answer =
        'I don\'t have a direct answer for that yet — right now I can tell you about overdue tasks, who has capacity this week, or your open task count. Try one of those.';
    } else {
      const openCount = await this.prisma.task.count({ where: { ...projectFilter, status: { in: OPEN_STATUSES } } });
      const projects = await this.prisma.project.findMany({ where: this.projectWhere(scoped), select: { name: true }, take: 10 });
      projects.forEach((p) => citations.push(`Project ${p.name}`));
      answer = `You have ${openCount} open task(s) across ${projects.length} project(s) in your scope: ${projects.map((p) => p.name).join(', ') || 'none'}. Ask about "overdue" tasks or "who is free" for specifics.`;
    }

    // Optional AI phrasing on top of the retrieved, cited facts.
    let text = answer;
    let aiGenerated = false;
    try {
      text = await this.gateway.complete(
        'chat',
        'You are a read-only assistant for an internal ERP. Answer ONLY from the provided facts; never invent data. Keep it to 2-3 sentences and preserve any names/numbers.',
        `Question: ${question}\nFacts: ${answer}`,
      );
      aiGenerated = true;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
    }

    await this.audit.record({ actorId: user.id, actorEmail: user.email, action: 'AI_CHAT', entityType: 'AiChat', ...meta });
    return { ...this.label(text, aiGenerated), citations };
  }
}
