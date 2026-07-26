import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../rbac/capability.service';
import type { AuthUser } from '../auth/auth-user';
import type { CreateModuleDto, CreateProjectDto, UpdateProjectDto } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

// Budget is visible to the roles that run projects or money company-wide
// (Spec §5.4, §3). The appointed manager of a project also sees ITS budget —
// handled per-project in stripBudget, not here.
const BUDGET_ROLES = new Set(['SUPER_ADMIN', 'HR', 'FINANCE']);

const PROJECT_SELECT = {
  id: true,
  name: true,
  status: true,
  description: true,
  startDate: true,
  endDate: true,
  budgetAmount: true,
  pm: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true, email: true } },
  _count: { select: { tasks: true, modules: true } },
} satisfies Prisma.ProjectSelect;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityService,
  ) {}

  private stripBudget<T extends { budgetAmount: unknown; pm?: { id: string } | null }>(
    project: T,
    user: AuthUser,
  ): T | Omit<T, 'budgetAmount'> {
    if (BUDGET_ROLES.has(user.role)) return project;
    // The person appointed to run this project sees its budget (2026-07-25).
    if (project.pm?.id === user.id) return project;
    const { budgetAmount: _omit, ...rest } = project;
    return rest;
  }

  /**
   * §3 scope resolution for read access: ALLOW = every project;
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

  private async assertProjectAccess(projectId: string, user: AuthUser): Promise<void> {
    if ((await this.resolveViewScope(user)) === 'ALL') return;
    const involved = await this.prisma.project.count({
      where: { id: projectId, ...this.ownProjectFilter(user.id) },
    });
    if (!involved) throw new ForbiddenException('You do not have access to this project');
  }

  async list(user: AuthUser) {
    const scope = await this.resolveViewScope(user);
    const items = await this.prisma.project.findMany({
      where: scope === 'OWN' ? this.ownProjectFilter(user.id) : undefined,
      select: PROJECT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return items.map((p) => this.stripBudget(p, user));
  }

  async get(id: string, user: AuthUser) {
    await this.assertProjectAccess(id, user);
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        ...PROJECT_SELECT,
        modules: { select: { id: true, name: true, position: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.stripBudget(project, user);
  }

  async create(dto: CreateProjectDto, actor: AuthUser, meta: Meta) {
    // There is no project "type" any more (2026-07-25): a project with an end
    // date is finite, one without is ongoing. That was the only thing the old
    // PROJECT/STREAM flag decided, and asking for it up front bought nothing.
    if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date cannot precede start date');
    }
    await this.assertRefs(dto.pmId, dto.clientId);

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        description: dto.description ?? null,
        pmId: dto.pmId ?? null,
        clientId: dto.clientId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        budgetAmount: dto.budgetAmount ?? null,
      },
      select: PROJECT_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: project.id,
      after: { name: project.name },
      ...meta,
    });
    return this.stripBudget(project, actor);
  }

  async update(id: string, dto: UpdateProjectDto, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true, pmId: true },
    });
    if (!existing) throw new NotFoundException('Project not found');

    // Editing a project: allowed by role (HR/SA hold projects.create_edit) or by
    // being the appointed manager of THIS project (2026-07-25, PM role removed).
    const grant = await this.capabilities.resolveGrant(
      actor.role,
      actor.resourceType,
      'projects.create_edit',
    );
    const mayEdit = grant === Grant.ALLOW || existing.pmId === actor.id;
    if (!mayEdit) {
      throw new ForbiddenException('Only the project manager, HR or a Super Admin can edit this project');
    }

    // ...but only HR/SA may hand the project to someone else. Otherwise an
    // appointed manager could quietly re-appoint themselves elsewhere or lock
    // the real owners out of their own project.
    if (dto.pmId !== undefined && grant !== Grant.ALLOW) {
      throw new ForbiddenException('Only HR or a Super Admin can change the project manager');
    }

    await this.assertRefs(dto.pmId, dto.clientId);

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        status: dto.status,
        description: dto.description,
        pmId: dto.pmId,
        clientId: dto.clientId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        budgetAmount: dto.budgetAmount,
      },
      select: PROJECT_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROJECT_UPDATED',
      entityType: 'Project',
      entityId: id,
      after: { fields: Object.keys(dto) },
      ...meta,
    });
    return this.stripBudget(project, actor);
  }

  /** Active internal users who can hold tasks (Spec §5.9 assignment screens, §24). */
  async listAssignableUsers() {
    // openTasks = live workload, so whoever assigns can pick the free person,
    // not just a familiar name. "Open" mirrors My Work: work not yet finished.
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['TEAM_LEAD', 'EMPLOYEE'] } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        resourceType: true,
        _count: {
          select: {
            assignedTasks: {
              where: { status: { notIn: ['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED'] } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return users.map(({ _count, ...u }) => ({ ...u, openTasks: _count.assignedTasks }));
  }

  /**
   * Who HR/Super Admin may appoint to run a project (2026-07-25). Anyone on
   * staff qualifies regardless of role — the appointment IS the authority, so
   * this is deliberately wide. Clients are excluded: they are external, and
   * appointing one would hand project controls to someone outside the company.
   */
  listAppointableManagers() {
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        resourceType: 'INTERNAL',
        role: { in: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── Modules ──
  async addModule(projectId: string, dto: CreateModuleDto, actor: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
    try {
      return await this.prisma.module.create({
        data: { projectId, name: dto.name.trim(), position: dto.position ?? 0 },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A module with that name already exists in this project');
      }
      throw err;
    }
  }

  async listModules(projectId: string, user: AuthUser) {
    await this.assertProjectAccess(projectId, user);
    return this.prisma.module.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  }

  private async assertRefs(pmId?: string, clientId?: string): Promise<void> {
    if (pmId) {
      // Must be an ACTIVE INTERNAL person. Previously this only checked that the
      // row existed, so a client — or a deactivated leaver — could be recorded as
      // a project's manager; since the appointment now carries real authority
      // over the project, that would be a live privilege hole, not a mislabel.
      const pm = await this.prisma.user.count({
        where: { id: pmId, status: 'ACTIVE', resourceType: 'INTERNAL', role: { not: 'CLIENT' } },
      });
      if (!pm) {
        throw new NotFoundException('Project manager must be an active internal user');
      }
    }
    if (clientId) {
      const client = await this.prisma.user.count({ where: { id: clientId, role: 'CLIENT' } });
      if (!client) throw new NotFoundException('Client not found');
    }
  }
}
