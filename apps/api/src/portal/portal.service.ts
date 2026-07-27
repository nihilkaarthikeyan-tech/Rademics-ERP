import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatClientCode } from '@rademics/types';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';

const DONE_STATUSES = ['COMPLETED', 'CLOSED'];

/**
 * Client portal read/write surface (Spec §5.5). Every query is scoped through
 * ClientProjectAccess: a client can only reach projects explicitly granted to them.
 * Cross-org / non-granted ids resolve to 404 (enumeration impossible, §10). Internal
 * task details, assignee names, internal comments and internal files are never
 * selected into a portal response.
 *
 * 2026-07-27: the client has no approval power at all — view progress, read the
 * staff-shared update feed, and ask for a status update. That is the entire
 * surface. There is no more Viewer/Approver distinction (see ClientProjectAccess) —
 * a grant row's existence IS the access.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
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

  /** Every projectId this client user may see. */
  private async accessSet(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.clientProjectAccess.findMany({
      where: { clientUserId: userId },
      select: { projectId: true },
    });
    return new Set(rows.map((r) => r.projectId));
  }

  async listProjects(user: AuthUser) {
    await this.assertActiveClient(user);
    const ids = [...(await this.accessSet(user.id))];
    if (ids.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        tasks: { where: { clientFacing: true }, select: { status: true } },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      percentComplete: this.percent(p.tasks),
    }));
  }

  async getProject(id: string, user: AuthUser) {
    await this.assertActiveClient(user);
    const access = await this.accessSet(user.id);
    if (!access.has(id)) throw new NotFoundException('Project not found'); // no access → 404, not 403 (§10)

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

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      description: project.description,
      percentComplete: this.percent(project.tasks),
      milestones,
      items: project.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, deadline: t.deadline })),
    };
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
      select: { id: true, body: true, createdAt: true },
    });
    // Attribution removed (2026-07-27): the client is not told which individual
    // works on their project, in either direction. Updates speak as the company.
    // The author is NOT selected above rather than dropped afterwards, so it
    // cannot leak through a future change to this mapping.
    return updates.map((u) => ({ id: u.id, body: u.body, createdAt: u.createdAt, authorName: null }));
  }

  /**
   * "Ask for a status update" (2026-07-27) — the client's only write action.
   * A short cooldown stops an impatient client from re-triggering the same
   * notification every few minutes.
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
    const access = await this.accessSet(user.id);
    if (!access.has(task.project.id)) throw new NotFoundException('Task not found');

    const COOLDOWN_MS = 60 * 60 * 1000;
    if (task.lastStatusRequestAt && Date.now() - task.lastStatusRequestAt.getTime() < COOLDOWN_MS) {
      throw new BadRequestException("You already asked recently — we'll get back to you soon.");
    }

    await this.prisma.task.update({ where: { id: taskId }, data: { lastStatusRequestAt: new Date() } });

    // The person the work is allocated to, plus the project's appointed manager
    // if there is one. Escalates to Super Admin / HR rather than vanishing when
    // the task has neither — the client is told the team was notified, so
    // somebody has to actually receive it.
    const recipients = [...new Set([task.assigneeId, task.project.pmId].filter((x): x is string => Boolean(x)))];
    // The alert names the client by CODE, not by name — it lands with the
    // assignee, who is exactly the person not meant to know who the client is.
    const client = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { clientOrg: { select: { number: true } } },
    });
    const clientLabel = client?.clientOrg ? formatClientCode(client.clientOrg.number) : 'A client';
    await this.notifications.notifyManyOrEscalate(recipients, {
      type: 'CLIENT_STATUS_REQUESTED',
      eventGroup: 'tasks',
      channel: 'IN_APP',
      title: 'The client is asking for a status update',
      body: `${clientLabel} asked about "${task.title}"`,
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
    const access = await this.accessSet(user.id);
    if (!projectId || !access.has(projectId)) throw new NotFoundException('File not found');
    return this.files.download(versionId, user); // enforces AVAILABLE + CLIENT_VISIBLE
  }

  // ── helpers ──
  private async assertTaskAccess(taskId: string, userId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    const access = await this.accessSet(userId);
    if (!task || !access.has(task.projectId)) throw new NotFoundException('Not found');
  }

  private percent(tasks: { status: string }[]): number {
    const active = tasks.filter((t) => t.status !== 'CANCELLED');
    if (active.length === 0) return 0;
    const done = active.filter((t) => DONE_STATUSES.includes(t.status)).length;
    return Math.round((done / active.length) * 100);
  }
}
