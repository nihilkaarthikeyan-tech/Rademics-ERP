import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TaskStatus as PrismaTaskStatus } from '@prisma/client';
import { Grant } from '@rademics/permissions';
import {
  TASK_TRANSITIONS,
  TaskAction,
  formatClientCode,
  nextTaskStatus,
  type TaskStatus as SharedTaskStatus,
  type TaskTransition,
  type TransitionActor,
} from '@rademics/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../rbac/capability.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';
import type {
  CreateCommentDto,
  CreateTaskDto,
  ChecklistItemDto,
  UpdateTaskDto,
} from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const TASK_SELECT = {
  id: true,
  projectId: true,
  moduleId: true,
  parentTaskId: true,
  title: true,
  description: true,
  priority: true,
  estimatedHours: true,
  actualHours: true,
  deadline: true,
  clientFacing: true,
  status: true,
  statusChangedAt: true,
  lastClientUpdateAt: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TaskSelect;

function isQuarterHour(v: number): boolean {
  return Math.abs(v * 4 - Math.round(v * 4)) < 1e-9;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Project authority (2026-07-25 decision, replaces the PM role).
   *
   * A capability passes either because the caller's ROLE holds it outright
   * (HR / Super Admin), or because the caller is the person APPOINTED to this
   * project — and then only for this project. Anyone can be appointed
   * regardless of role, so this is deliberately not expressible in the
   * role matrix; the guard cannot answer it and the service must.
   *
   * Callers are responsible for passing the project the action targets.
   */
  private async assertProjectAuthority(
    user: AuthUser,
    projectId: string,
    capability: 'tasks.create' | 'tasks.assign' | 'tasks.review',
  ): Promise<void> {
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, capability);
    if (grant === Grant.ALLOW) return;

    const appointed = await this.prisma.project.count({ where: { id: projectId, pmId: user.id } });
    if (appointed) return;

    throw new ForbiddenException(
      'Only the project manager, HR or a Super Admin can do this on this project',
    );
  }

  /** True when the caller is the appointed manager of the given project. */
  private async isProjectManager(userId: string, projectId: string): Promise<boolean> {
    return (await this.prisma.project.count({ where: { id: projectId, pmId: userId } })) > 0;
  }

  // ── Create (Spec §5.4, §24) ──
  async create(dto: CreateTaskDto, actor: AuthUser, meta: Meta) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    await this.assertProjectAuthority(actor, dto.projectId, 'tasks.create');

    if (dto.estimatedHours !== undefined && !isQuarterHour(dto.estimatedHours)) {
      throw new BadRequestException('Estimated hours must be in quarter-hour steps (§24)');
    }
    if (dto.clientFacing && !dto.deadline) {
      throw new BadRequestException('Client-facing tasks require a deadline (§24)');
    }
    if (dto.parentTaskId) {
      const parent = await this.prisma.task.findUnique({
        where: { id: dto.parentTaskId },
        select: { id: true, parentTaskId: true, projectId: true },
      });
      if (!parent) throw new NotFoundException('Parent task not found');
      if (parent.parentTaskId) throw new BadRequestException('Subtasks are one level deep only (§24)');
      if (parent.projectId !== dto.projectId) {
        throw new BadRequestException('Subtask must belong to the same project as its parent');
      }
    }
    if (dto.moduleId) {
      const mod = await this.prisma.module.count({ where: { id: dto.moduleId, projectId: dto.projectId } });
      if (!mod) throw new NotFoundException('Module not found in this project');
    }

    const task = await this.prisma.task.create({
      data: {
        projectId: dto.projectId,
        moduleId: dto.moduleId ?? null,
        parentTaskId: dto.parentTaskId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        priority: dto.priority ?? 'MEDIUM',
        estimatedHours: dto.estimatedHours ?? null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        clientFacing: dto.clientFacing ?? false,
        status: 'DRAFT',
        createdById: actor.id,
        watchers: { create: [{ userId: actor.id }] }, // creator watches by default
      },
      select: TASK_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: task.id,
      after: { title: task.title, projectId: task.projectId },
      ...meta,
    });

    // One-step create-and-assign (2026-07-25): the DTO has always carried an
    // optional assigneeId but create() dropped it, forcing a second trip through
    // the assign screen. Delegating keeps every §24 rule (can-hold, freelancer,
    // watcher, history, notification) in exactly one place.
    if (dto.assigneeId) {
      return this.assign(task.id, dto.assigneeId, actor, meta);
    }
    return task;
  }

  /**
   * §3 scope resolution for read access: ALLOW = see everything;
   * SCOPED (TL/EMP via projects.view_own_team) = own projects only; else 403.
   */
  private async resolveViewScope(user: AuthUser): Promise<'ALL' | 'OWN'> {
    // Clients never use the internal task surface — they have the portal (§5.5).
    // Their projects.view_own_team=SCOPED grant is for portal scoping, not here;
    // without this, the list endpoint would answer them with an empty 200 instead
    // of a clean 403.
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Clients access their work through the portal');
    }
    const all = await this.capabilities.resolveGrant(user.role, user.resourceType, 'projects.view_all');
    if (all === Grant.ALLOW) return 'ALL';
    const own = await this.capabilities.resolveGrant(user.role, user.resourceType, 'projects.view_own_team');
    if (own === Grant.ALLOW || own === Grant.SCOPED) return 'OWN';
    throw new ForbiddenException('Missing capability: projects.view_all');
  }

  /** "Own project" (§3 view_own_team): the caller is its PM or holds a task in it. */
  private ownProjectFilter(userId: string): Prisma.ProjectWhereInput {
    return { OR: [{ pmId: userId }, { tasks: { some: { assigneeId: userId } } }] };
  }

  async get(id: string, user: AuthUser) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: {
        ...TASK_SELECT,
        createdById: true,
        project: { select: { id: true, name: true, pmId: true } },
        module: { select: { id: true, name: true } },
        subtasks: { select: { id: true, title: true, status: true, assignee: { select: { id: true, name: true } } } },
        checklist: { select: { id: true, text: true, done: true, position: true }, orderBy: { position: 'asc' } },
        watchers: { select: { user: { select: { id: true, name: true } } } },
        history: {
          select: { id: true, fromStatus: true, toStatus: true, action: true, actorEmail: true, comment: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');

    if ((await this.resolveViewScope(user)) === 'OWN') {
      // The board (list endpoint) already shows every task in a project you are
      // part of — opening one of those cards must not 403. Project membership
      // (you hold a task in it) grants READ here; acting on the task stays
      // gated per-action by assertActor, so a teammate can look but not touch.
      const involved =
        task.assignee?.id === user.id ||
        task.createdById === user.id ||
        task.project.pmId === user.id ||
        task.watchers.some((w) => w.user.id === user.id) ||
        (await this.prisma.task.count({
          where: { projectId: task.project.id, assigneeId: user.id },
        })) > 0;
      if (!involved) throw new ForbiddenException('You do not have access to this task');
    }

    const comments = await this.listComments(id, user);
    return { ...task, comments, overdue: this.isOverdue(task) };
  }

  async update(id: string, dto: UpdateTaskDto, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, clientFacing: true, deadline: true, projectId: true },
    });
    if (!existing) throw new NotFoundException('Task not found');
    await this.assertProjectAuthority(actor, existing.projectId, 'tasks.create');

    if (dto.estimatedHours !== undefined && !isQuarterHour(dto.estimatedHours)) {
      throw new BadRequestException('Estimated hours must be in quarter-hour steps (§24)');
    }
    const willBeClientFacing = dto.clientFacing ?? existing.clientFacing;
    const willHaveDeadline = dto.deadline !== undefined ? dto.deadline : existing.deadline;
    if (willBeClientFacing && !willHaveDeadline) {
      throw new BadRequestException('Client-facing tasks require a deadline (§24)');
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        moduleId: dto.moduleId,
        priority: dto.priority,
        estimatedHours: dto.estimatedHours,
        actualHours: dto.actualHours,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        clientFacing: dto.clientFacing,
      },
      select: TASK_SELECT,
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'TASK_UPDATED',
      entityType: 'Task',
      entityId: id,
      after: { fields: Object.keys(dto) },
      ...meta,
    });
    return task;
  }

  async list(
    query: {
      projectId?: string;
      assigneeId?: string;
      status?: string;
      priority?: string;
      page: number;
      pageSize: number;
    },
    user: AuthUser,
  ) {
    const where: Prisma.TaskWhereInput = {
      projectId: query.projectId,
      assigneeId: query.assigneeId,
      status: query.status as PrismaTaskStatus | undefined,
      priority: query.priority as Prisma.TaskWhereInput['priority'],
    };
    if ((await this.resolveViewScope(user)) === 'OWN') {
      where.project = this.ownProjectFilter(user.id);
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: TASK_SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    return {
      items: items.map((t) => ({ ...t, overdue: this.isOverdue(t) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The caller's work queue (My Work). CLOSED/CANCELLED are noise and excluded. */
  async listMine(user: AuthUser) {
    const items = await this.prisma.task.findMany({
      where: { assigneeId: user.id, status: { notIn: ['CLOSED', 'CANCELLED'] } },
      select: { ...TASK_SELECT, project: { select: { id: true, name: true } } },
      orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return { items: items.map((t) => ({ ...t, overdue: this.isOverdue(t) })) };
  }

  /**
   * Daily sweep for handoffs nobody picked up: tasks sitting in ASSIGNED for
   * 24h+ remind their assignee each morning; at 48h+ the project's manager is
   * told too. An unaccepted task blocks the whole §6 chain silently — this is
   * the chase. Runs from the tasks queue (see tasks.processor.ts).
   */
  async runAcceptanceSweep(now = new Date()): Promise<{ reminded: number; escalated: number }> {
    const DAY = 86_400_000;
    const stale = await this.prisma.task.findMany({
      where: {
        status: 'ASSIGNED',
        assigneeId: { not: null },
        statusChangedAt: { lt: new Date(now.getTime() - DAY) },
      },
      select: {
        id: true,
        title: true,
        assigneeId: true,
        statusChangedAt: true,
        assignee: { select: { name: true } },
        project: { select: { pmId: true } },
      },
    });
    let escalated = 0;
    for (const t of stale) {
      const days = Math.floor((now.getTime() - t.statusChangedAt.getTime()) / DAY);
      await this.notifications.notify({
        userId: t.assigneeId!,
        type: 'TASK_ACCEPT_REMINDER',
        eventGroup: 'tasks',
        title: 'Reminder: a task is waiting for you to accept it',
        body: `${t.title} — assigned ${days} day${days === 1 ? '' : 's'} ago`,
        entityType: 'Task',
        entityId: t.id,
      });
      if (days >= 2 && t.project.pmId && t.project.pmId !== t.assigneeId) {
        await this.notifications.notify({
          userId: t.project.pmId,
          type: 'TASK_ACCEPT_STALLED',
          eventGroup: 'tasks',
          title: 'A task is stuck waiting to be accepted',
          body: `${t.assignee?.name ?? 'The assignee'} hasn't accepted "${t.title}" (${days} days)`,
          entityType: 'Task',
          entityId: t.id,
        });
        escalated += 1;
      }
    }
    return { reminded: stale.length, escalated };
  }

  /**
   * Daily chase for client-facing tasks the client hasn't seen movement on in
   * 3+ days — a status change or a client-visible comment both reset the
   * clock (see lastClientUpdateAt stamping in transition()/assign()/addComment()).
   * Staff-only nudge: the client never sees a countdown or a "you were
   * ignored" message, matching how the acceptance sweep stays internal too.
   * Skipped once the task is finished — nothing to update at that point.
   */
  async runClientUpdateSweep(now = new Date()): Promise<{ reminded: number }> {
    const THREE_DAYS = 3 * 86_400_000;
    const cutoff = new Date(now.getTime() - THREE_DAYS);
    const stale = await this.prisma.task.findMany({
      where: {
        clientFacing: true,
        status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] },
        OR: [{ lastClientUpdateAt: null, createdAt: { lt: cutoff } }, { lastClientUpdateAt: { lt: cutoff } }],
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        lastClientUpdateAt: true,
        assigneeId: true,
        project: { select: { pmId: true, clientOrg: { select: { number: true } } } },
      },
    });
    for (const t of stale) {
      const since = t.lastClientUpdateAt ?? t.createdAt;
      const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
      const recipients = [...new Set([t.assigneeId, t.project.pmId].filter((x): x is string => Boolean(x)))];
      await this.notifications.notifyManyOrEscalate(recipients, {
        type: 'CLIENT_UPDATE_DUE',
        eventGroup: 'tasks',
        title: 'A client is waiting for an update',
        // Client identified by code — this nudge goes to the assignee.
        body: `${t.title}${t.project.clientOrg ? ` (${formatClientCode(t.project.clientOrg.number)})` : ''} — no update in ${days} day${days === 1 ? '' : 's'}`,
        entityType: 'Task',
        entityId: t.id,
      });
    }
    return { reminded: stale.length };
  }

  // ── Assign / Reassign (Spec §6, §24) ──
  async assign(taskId: string, assigneeId: string, actor: AuthUser, meta: Meta) {
    const task = await this.loadForTransition(taskId);
    const action = task.status === 'DRAFT' ? TaskAction.ASSIGN : task.status === 'ASSIGNED' ? TaskAction.REASSIGN : null;
    if (!action) throw new BadRequestException(`A task in ${task.status} cannot be (re)assigned`);

    const transition = this.findTransition(task.status as SharedTaskStatus, action)!;
    this.assertActor(transition.actors, actor, task);

    const assignee = await this.prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true, role: true, resourceType: true, status: true },
    });
    if (!assignee || assignee.status === 'DEACTIVATED') throw new NotFoundException('Assignee not found');

    // Assignee must be able to hold tasks (§24).
    const canHold = await this.capabilities.resolveGrant(
      assignee.role,
      assignee.resourceType,
      'tasks.update_own_status',
    );
    if (canHold === Grant.DENY) throw new BadRequestException('That user cannot be assigned tasks');
    // Freelancers may only be brought onto a project by whoever runs it (§24) —
    // the appointed project manager, HR, or a Super Admin.
    if (assignee.resourceType === 'FREELANCE') {
      const mayUseFreelancers =
        actor.role === 'SUPER_ADMIN' ||
        actor.role === 'HR' ||
        (await this.isProjectManager(actor.id, task.projectId));
      if (!mayUseFreelancers) {
        throw new ForbiddenException(
          'Only the project manager, HR or a Super Admin may assign a freelancer',
        );
      }
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.update({
        where: { id: taskId },
        data: {
          assigneeId,
          status: 'ASSIGNED',
          statusChangedAt: now,
          // The client's status label changes too (e.g. "Not started" → "Planned")
          // — that's visible movement, so it counts as a client update.
          lastClientUpdateAt: task.clientFacing ? now : undefined,
        },
        select: TASK_SELECT,
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: 'ASSIGNED',
          action,
          actorId: actor.id,
          actorEmail: actor.email,
        },
      });
      await tx.taskWatcher.upsert({
        where: { taskId_userId: { taskId, userId: assigneeId } },
        update: {},
        create: { taskId, userId: assigneeId },
      });
      return t;
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'TASK_TRANSITION',
      entityType: 'Task',
      entityId: taskId,
      before: { status: task.status },
      after: { status: 'ASSIGNED', action },
      ...meta,
    });
    await this.notifications.notify({
      userId: assigneeId,
      type: action === TaskAction.ASSIGN ? 'TASK_ASSIGNED' : 'TASK_REASSIGNED',
      eventGroup: 'tasks',
      title: action === TaskAction.ASSIGN ? 'You were assigned a task' : 'A task was reassigned to you',
      body: task.title,
      entityType: 'Task',
      entityId: taskId,
    });
    return updated;
  }

  // ── Generic §6 transition ──
  async transition(taskId: string, action: TaskAction, comment: string | undefined, actor: AuthUser, meta: Meta) {
    if (action === TaskAction.ASSIGN || action === TaskAction.REASSIGN) {
      throw new BadRequestException('Use the assign endpoint to (re)assign a task');
    }
    const task = await this.loadForTransition(taskId);

    const transition = this.findTransition(task.status as SharedTaskStatus, action);
    const to = nextTaskStatus(task.status as SharedTaskStatus, action);
    if (!transition || !to) {
      throw new BadRequestException(`Illegal transition: ${action} from ${task.status} (§6)`);
    }
    this.assertActor(transition.actors, actor, task);

    if (transition.requiresComment && !comment?.trim()) {
      throw new BadRequestException('A comment is required for this action (§6)');
    }
    if (to === 'CLOSED') {
      const openSub = task.subtasks.some((s) => s.status !== 'CLOSED' && s.status !== 'CANCELLED');
      if (openSub) throw new BadRequestException('Cannot close a task with open subtasks (§24)');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.update({
        where: { id: taskId },
        data: {
          status: to as PrismaTaskStatus,
          statusChangedAt: now,
          // A status move is visible progress to the client — resets the
          // 3-day staleness clock the same way a client-visible comment does.
          lastClientUpdateAt: task.clientFacing ? now : undefined,
        },
        select: TASK_SELECT,
      });
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: to as PrismaTaskStatus,
          action,
          actorId: actor.id,
          actorEmail: actor.email,
          comment: comment?.trim() ?? null,
        },
      });
      return t;
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'TASK_TRANSITION',
      entityType: 'Task',
      entityId: taskId,
      before: { status: task.status },
      after: { status: to, action },
      ...meta,
    });
    await this.notifyOnTransition(task, action);
    return updated;
  }

  // ── Comments (Spec §5.4) ──
  async addComment(taskId: string, dto: CreateCommentDto, actor: AuthUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, clientFacing: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (dto.clientVisible && !task.clientFacing) {
      throw new BadRequestException('Only client-facing tasks can have client-visible comments (§5.4)');
    }

    const comment = await this.prisma.comment.create({
      data: {
        taskId,
        authorId: actor.id,
        authorEmail: actor.email,
        body: dto.body.trim(),
        visibility: dto.clientVisible ? 'CLIENT_VISIBLE' : 'INTERNAL',
        mentions: dto.mentionUserIds?.length
          ? { create: [...new Set(dto.mentionUserIds)].map((userId) => ({ userId })) }
          : undefined,
      },
      include: { author: { select: { id: true, name: true } } },
    });

    // A client-visible comment IS a progress update — resets the staleness clock.
    if (dto.clientVisible) {
      await this.prisma.task.update({ where: { id: taskId }, data: { lastClientUpdateAt: new Date() } });
    }

    if (dto.mentionUserIds?.length) {
      await this.notifications.notifyMany([...new Set(dto.mentionUserIds)], {
        type: 'MENTION',
        eventGroup: 'mentions',
        title: `${actor.email} mentioned you`,
        body: task.title,
        entityType: 'Task',
        entityId: taskId,
      });
    }
    return comment;
  }

  async listComments(taskId: string, user: AuthUser) {
    return this.prisma.comment.findMany({
      where: {
        taskId,
        // Clients only ever see client-visible comments (§5.5).
        visibility: user.role === 'CLIENT' ? 'CLIENT_VISIBLE' : undefined,
      },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  // ── Checklist (Spec §5.4) ──
  async addChecklistItem(taskId: string, dto: ChecklistItemDto, actor: AuthUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.assertProjectAuthority(actor, task.projectId, 'tasks.create');

    const count = await this.prisma.checklistItem.count({ where: { taskId } });
    return this.prisma.checklistItem.create({
      data: { taskId, text: dto.text.trim(), position: count },
    });
  }

  async toggleChecklistItem(taskId: string, itemId: string) {
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, taskId } });
    if (!item) throw new NotFoundException('Checklist item not found');
    return this.prisma.checklistItem.update({ where: { id: itemId }, data: { done: !item.done } });
  }

  // ── Watchers (Spec §5.4) ──
  async addWatcher(taskId: string, userId: string) {
    return this.prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId, userId } },
      update: {},
      create: { taskId, userId },
    });
  }

  removeWatcher(taskId: string, userId: string) {
    return this.prisma.taskWatcher.deleteMany({ where: { taskId, userId } });
  }

  // ── helpers ──
  private isOverdue(task: { deadline: Date | null; status: string }): boolean {
    // Overdue is a COMPUTED flag, never a status (§6).
    if (!task.deadline) return false;
    const terminal = ['COMPLETED', 'CLOSED', 'CANCELLED'];
    return !terminal.includes(task.status) && task.deadline < new Date();
  }

  private loadForTransition(taskId: string) {
    return this.prisma.task
      .findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          status: true,
          clientFacing: true,
          assigneeId: true,
          projectId: true,
          project: { select: { pmId: true, clientId: true } },
          subtasks: { select: { status: true } },
          watchers: { select: { userId: true } },
        },
      })
      .then((t) => {
        if (!t) throw new NotFoundException('Task not found');
        return t;
      });
  }

  private findTransition(from: SharedTaskStatus, action: TaskAction): TaskTransition | null {
    if (action === TaskAction.CANCEL) {
      return TASK_TRANSITIONS.find((t) => t.action === TaskAction.CANCEL) ?? null;
    }
    return TASK_TRANSITIONS.find((t) => t.from === from && t.action === action && !t.fromAny) ?? null;
  }

  private assertActor(
    actors: readonly TransitionActor[],
    user: AuthUser,
    task: { assigneeId: string | null; project: { pmId: string | null } },
  ): void {
    const ok = actors.some((a) => {
      switch (a) {
        case 'ASSIGNEE':
          return task.assigneeId === user.id;
        // Not a role: the person appointed to THIS task's project, plus the two
        // roles that run projects company-wide (2026-07-25, PM role removed).
        case 'PROJECT_MANAGER':
          return (
            (task.project.pmId !== null && task.project.pmId === user.id) ||
            user.role === 'SUPER_ADMIN' ||
            user.role === 'HR'
          );
        case 'TEAM_LEAD':
          return user.role === 'TEAM_LEAD' || user.role === 'SUPER_ADMIN';
        default:
          return false;
      }
    });
    if (!ok) throw new ForbiddenException('You are not an eligible actor for this transition (§6)');
  }

  private async notifyOnTransition(
    task: {
      id: string;
      title: string;
      assigneeId: string | null;
      projectId: string;
      project: { pmId: string | null };
      watchers: { userId: string }[];
    },
    action: TaskAction,
  ): Promise<void> {
    const base = { eventGroup: 'tasks', body: task.title, entityType: 'Task', entityId: task.id };
    switch (action) {
      case TaskAction.SUBMIT:
        await this.notifications.notify({ ...base, userId: task.project.pmId ?? '', type: 'TASK_REVIEW_REQUESTED', title: 'A task is ready for review' });
        break;
      case TaskAction.SEND_BACK:
        await this.notifications.notify({ ...base, userId: task.assigneeId ?? '', type: 'TASK_SENT_BACK', title: 'Your task was sent back' });
        break;
      case TaskAction.APPROVE_REVIEW:
        // Always → COMPLETED now (2026-07-27) — the client no longer sits
        // between internal approval and completion.
        await this.notifications.notifyMany([task.assigneeId, ...task.watchers.map((w) => w.userId)], { ...base, type: 'TASK_COMPLETED', title: 'A task was completed' });
        break;
      case TaskAction.CANCEL:
        await this.notifications.notifyMany([task.assigneeId, ...task.watchers.map((w) => w.userId)], { ...base, type: 'TASK_CANCELLED', title: 'A task was cancelled' });
        break;
      default:
        break;
    }
  }
}
