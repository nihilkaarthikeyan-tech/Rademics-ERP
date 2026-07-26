import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TaskAction } from '@rademics/types';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../projects/tasks.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const DONE_STATUSES = ['COMPLETED', 'CLOSED'];

/**
 * Client portal read/write surface (Spec §5.5). Every query is scoped through
 * ClientProjectAccess: a client can only reach projects explicitly granted to them,
 * and only the CLIENT-VISIBLE slice of those. Cross-org / non-granted ids resolve to
 * 404 (enumeration impossible, §10). Internal task details, assignee names, internal
 * comments and internal files are never selected into a portal response.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Org must exist and be active, else the portal shows an "access ended" page (§25). */
  private async assertActiveClient(user: AuthUser): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { clientOrgId: true, clientOrg: { select: { status: true } } },
    });
    if (!u?.clientOrgId || u.clientOrg?.status === 'DEACTIVATED') {
      throw new ForbiddenException('ACCESS_ENDED');
    }
  }

  /** projectId → access level, for exactly the projects this client user may see. */
  private async accessMap(userId: string): Promise<Map<string, 'VIEWER' | 'APPROVER'>> {
    const rows = await this.prisma.clientProjectAccess.findMany({
      where: { clientUserId: userId },
      select: { projectId: true, level: true },
    });
    return new Map(rows.map((r) => [r.projectId, r.level]));
  }

  async listProjects(user: AuthUser) {
    await this.assertActiveClient(user);
    const access = await this.accessMap(user.id);
    const ids = [...access.keys()];
    if (ids.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        tasks: {
          where: { clientFacing: true },
          select: { status: true },
        },
        _count: { select: { tasks: { where: { clientFacing: true, status: 'CLIENT_REVIEW' } } } },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      level: access.get(p.id),
      percentComplete: this.percent(p.tasks),
      awaitingApproval: p._count.tasks,
    }));
  }

  /** Client's own invoices (Spec §5.5, §17.7). Scoped to the user's org; drafts and
   *  cancelled invoices are never exposed. Only client-facing fields are serialized. */
  async listInvoices(user: AuthUser) {
    await this.assertActiveClient(user);
    const u = await this.prisma.user.findUnique({ where: { id: user.id }, select: { clientOrgId: true } });
    if (!u?.clientOrgId) return [];
    const invoices = await this.prisma.invoice.findMany({
      where: { clientOrgId: u.clientOrgId, status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] } },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true, number: true, status: true, issueDate: true, dueDate: true,
        total: true, amountPaid: true, project: { select: { name: true } },
      },
    });
    return invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      total: Number(i.total),
      amountPaid: Number(i.amountPaid),
      balance: Math.round((Number(i.total) - Number(i.amountPaid)) * 100) / 100,
      projectName: i.project?.name ?? null,
    }));
  }

  async getProject(id: string, user: AuthUser) {
    await this.assertActiveClient(user);
    const access = await this.accessMap(user.id);
    const level = access.get(id);
    if (!level) throw new NotFoundException('Project not found'); // no access → 404, not 403 (§10)

    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        description: true,
        modules: { select: { id: true, name: true }, orderBy: { position: 'asc' } },
        // Only client-facing tasks; NO assignee, NO internal description, NO internal comments.
        tasks: {
          where: { clientFacing: true },
          select: { id: true, title: true, status: true, deadline: true, moduleId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const milestones = project.modules.map((m) => {
      const tasks = project.tasks.filter((t) => t.moduleId === m.id);
      return { id: m.id, name: m.name, percentComplete: this.percent(tasks) };
    });
    const deliverables = project.tasks
      .filter((t) => t.status === 'CLIENT_REVIEW')
      .map((t) => ({ id: t.id, title: t.title, deadline: t.deadline, canApprove: level === 'APPROVER' }));

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      description: project.description,
      level,
      percentComplete: this.percent(project.tasks),
      milestones,
      deliverables,
      // Client-visible task list, minus CLIENT_REVIEW tasks — those are already
      // shown (with actions) in `deliverables` above; keeping them here too would
      // list the same task twice.
      items: project.tasks
        .filter((t) => t.status !== 'CLIENT_REVIEW')
        .map((t) => ({ id: t.id, title: t.title, status: t.status, deadline: t.deadline })),
    };
  }

  async listDeliverables(user: AuthUser) {
    await this.assertActiveClient(user);
    const access = await this.accessMap(user.id);
    const ids = [...access.keys()];
    if (ids.length === 0) return [];

    const tasks = await this.prisma.task.findMany({
      where: { projectId: { in: ids }, clientFacing: true, status: 'CLIENT_REVIEW' },
      select: { id: true, title: true, deadline: true, project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline,
      project: t.project,
      canApprove: access.get(t.project.id) === 'APPROVER',
    }));
  }

  approve(taskId: string, comment: string | undefined, user: AuthUser, meta: Meta) {
    return this.decide(taskId, TaskAction.CLIENT_APPROVE, comment, user, meta);
  }

  requestRevision(taskId: string, comment: string, user: AuthUser, meta: Meta) {
    return this.decide(taskId, TaskAction.CLIENT_REQUEST_REVISION, comment, user, meta);
  }

  async listFiles(taskId: string, user: AuthUser) {
    await this.assertActiveClient(user);
    await this.assertTaskAccess(taskId, user.id);
    return this.files.listForTask(taskId, user); // FilesService scopes clients to AVAILABLE + CLIENT_VISIBLE
  }

  /**
   * The progress feed (2026-07-27): client-visible comments staff have posted
   * on this task, oldest first — a running story of what's happened, not just
   * a bare status word. Attribution is deliberate here (unlike the rest of the
   * portal, which strips assignee/internal identity): a note written FOR the
   * client to read is a curated, staff-approved message, not an internal
   * routing detail — showing who wrote it builds trust rather than leaking
   * anything.
   */
  async listUpdates(taskId: string, user: AuthUser) {
    await this.assertActiveClient(user);
    await this.assertTaskAccess(taskId, user.id);
    const updates = await this.prisma.comment.findMany({
      where: { taskId, visibility: 'CLIENT_VISIBLE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
    });
    return updates.map((u) => ({ id: u.id, body: u.body, createdAt: u.createdAt, authorName: u.author?.name ?? null }));
  }

  /**
   * "Ask for a status update" (2026-07-27) — deliberately open to VIEWER and
   * APPROVER alike: it's a question, not a decision, so it doesn't need the
   * approve/request-revision gate. A short cooldown stops an impatient client
   * from re-triggering the same notification every few minutes.
   */
  async requestStatus(taskId: string, user: AuthUser) {
    await this.assertActiveClient(user);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        clientFacing: true,
        assigneeId: true,
        lastStatusRequestAt: true,
        project: { select: { id: true, pmId: true } },
      },
    });
    if (!task || !task.clientFacing) throw new NotFoundException('Task not found');
    const access = await this.accessMap(user.id);
    if (!access.has(task.project.id)) throw new NotFoundException('Task not found');

    const COOLDOWN_MS = 60 * 60 * 1000;
    if (task.lastStatusRequestAt && Date.now() - task.lastStatusRequestAt.getTime() < COOLDOWN_MS) {
      throw new BadRequestException("You already asked recently — we'll get back to you soon.");
    }

    await this.prisma.task.update({ where: { id: taskId }, data: { lastStatusRequestAt: new Date() } });

    const recipients = [...new Set([task.assigneeId, task.project.pmId].filter((x): x is string => Boolean(x)))];
    const client = await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
    await this.notifications.notifyMany(recipients, {
      type: 'CLIENT_STATUS_REQUESTED',
      eventGroup: 'tasks',
      title: 'The client is asking for a status update',
      body: `${client?.name ?? 'A client'} asked about "${task.title}"`,
      entityType: 'Task',
      entityId: task.id,
    });
    return { requested: true };
  }

  async download(versionId: string, user: AuthUser) {
    await this.assertActiveClient(user);
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { fileAsset: { select: { task: { select: { projectId: true } } } } },
    });
    const projectId = v?.fileAsset?.task?.projectId;
    const access = await this.accessMap(user.id);
    if (!projectId || !access.has(projectId)) throw new NotFoundException('File not found');
    return this.files.download(versionId, user); // enforces AVAILABLE + CLIENT_VISIBLE
  }

  // ── helpers ──
  private async decide(taskId: string, action: TaskAction, comment: string | undefined, user: AuthUser, meta: Meta) {
    await this.assertActiveClient(user);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, clientFacing: true },
    });
    if (!task || !task.clientFacing) throw new NotFoundException('Deliverable not found');

    const access = await this.accessMap(user.id);
    if (!access.has(task.projectId)) throw new NotFoundException('Deliverable not found');
    if (access.get(task.projectId) !== 'APPROVER') {
      throw new ForbiddenException('Only an Approver can act on deliverables');
    }
    // Delegate to the §6 state machine: validates the transition, writes immutable
    // history, and notifies the PM (Spec §5.5).
    return this.tasks.transition(taskId, action, comment, user, meta);
  }

  private async assertTaskAccess(taskId: string, userId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    const access = await this.accessMap(userId);
    if (!task || !access.has(task.projectId)) throw new NotFoundException('Not found');
  }

  private percent(tasks: { status: string }[]): number {
    const active = tasks.filter((t) => t.status !== 'CANCELLED');
    if (active.length === 0) return 0;
    const done = active.filter((t) => DONE_STATUSES.includes(t.status)).length;
    return Math.round((done / active.length) * 100);
  }
}
