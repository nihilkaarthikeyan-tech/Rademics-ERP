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

  // ── Create (Spec §5.4, §24) ──
  async create(dto: CreateTaskDto, actor: AuthUser, meta: Meta) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

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
    return task;
  }

  /**
   * §3 scope resolution for read access: ALLOW = see everything;
   * SCOPED (TL/EMP via projects.view_own_team) = own projects only; else 403.
   */
  private async resolveViewScope(user: AuthUser): Promise<'ALL' | 'OWN'> {
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
      const involved =
        task.assignee?.id === user.id ||
        task.createdById === user.id ||
        task.project.pmId === user.id ||
        task.watchers.some((w) => w.user.id === user.id);
      if (!involved) throw new ForbiddenException('You do not have access to this task');
    }

    const comments = await this.listComments(id, user);
    return { ...task, comments, overdue: this.isOverdue(task) };
  }

  async update(id: string, dto: UpdateTaskDto, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.task.findUnique({
      where: { id },
      select: { id: true, clientFacing: true, deadline: true },
    });
    if (!existing) throw new NotFoundException('Task not found');

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
    // Freelancer assignable only by PM (§24).
    if (assignee.resourceType === 'FREELANCE' && actor.role !== 'PM' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a PM may assign a freelancer');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.update({
        where: { id: taskId },
        data: { assigneeId, status: 'ASSIGNED' },
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
    const to = nextTaskStatus(task.status as SharedTaskStatus, action, { clientFacing: task.clientFacing });
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.update({
        where: { id: taskId },
        data: { status: to as PrismaTaskStatus },
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
    await this.notifyOnTransition(task, action, to as SharedTaskStatus);
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
  async addChecklistItem(taskId: string, dto: ChecklistItemDto) {
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
    const terminal = ['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED'];
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
    task: { assigneeId: string | null },
  ): void {
    const ok = actors.some((a) => {
      switch (a) {
        case 'ASSIGNEE':
          return task.assigneeId === user.id;
        case 'PM':
          return user.role === 'PM' || user.role === 'SUPER_ADMIN';
        case 'TEAM_LEAD':
          return user.role === 'TEAM_LEAD' || user.role === 'SUPER_ADMIN';
        case 'FINANCE':
          return user.role === 'FINANCE' || user.role === 'SUPER_ADMIN';
        case 'CLIENT_APPROVER':
          return user.role === 'CLIENT';
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
      project: { pmId: string | null; clientId: string | null };
      watchers: { userId: string }[];
    },
    action: TaskAction,
    to: SharedTaskStatus,
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
        if (to === 'CLIENT_REVIEW') {
          // Notify every Approver-level client user on this project (Spec §5.5).
          const approvers = await this.prisma.clientProjectAccess.findMany({
            where: { projectId: task.projectId, level: 'APPROVER' },
            select: { clientUserId: true },
          });
          const recipients = approvers.length
            ? approvers.map((a) => a.clientUserId)
            : [task.project.clientId]; // fallback to the primary contact
          await this.notifications.notifyMany(recipients, { ...base, type: 'CLIENT_APPROVAL_REQUESTED', title: 'A deliverable awaits your approval' });
        } else {
          await this.notifications.notifyMany([task.assigneeId, ...task.watchers.map((w) => w.userId)], { ...base, type: 'TASK_COMPLETED', title: 'A task was completed' });
        }
        break;
      case TaskAction.CLIENT_APPROVE:
        await this.notifications.notify({ ...base, userId: task.project.pmId ?? '', type: 'CLIENT_APPROVED', title: 'The client approved a deliverable' });
        break;
      case TaskAction.CLIENT_REQUEST_REVISION:
        await this.notifications.notifyMany([task.project.pmId, task.assigneeId], { ...base, type: 'CLIENT_REVISION_REQUESTED', title: 'The client requested a revision' });
        break;
      case TaskAction.CANCEL:
        await this.notifications.notifyMany([task.assigneeId, ...task.watchers.map((w) => w.userId)], { ...base, type: 'TASK_CANCELLED', title: 'A task was cancelled' });
        break;
      default:
        break;
    }
  }
}
