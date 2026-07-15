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

// Budget is visible to PM / Finance / Admin only (Spec §5.4, §3).
const BUDGET_ROLES = new Set(['SUPER_ADMIN', 'PM', 'FINANCE']);

const PROJECT_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  description: true,
  startDate: true,
  endDate: true,
  cadence: true,
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

  private stripBudget<T extends { budgetAmount: unknown }>(project: T, user: AuthUser): T | Omit<T, 'budgetAmount'> {
    if (BUDGET_ROLES.has(user.role)) return project;
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
    if (dto.type === 'STREAM' && dto.endDate) {
      throw new BadRequestException('A work stream has no end date (§5.4)');
    }
    if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date cannot precede start date');
    }
    await this.assertRefs(dto.pmId, dto.clientId);

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        description: dto.description ?? null,
        pmId: dto.pmId ?? null,
        clientId: dto.clientId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.type === 'STREAM' ? null : dto.endDate ? new Date(dto.endDate) : null,
        budgetAmount: dto.budgetAmount ?? null,
        cadence: dto.cadence ?? null,
      },
      select: PROJECT_SELECT,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: project.id,
      after: { name: project.name, type: project.type },
      ...meta,
    });
    return this.stripBudget(project, actor);
  }

  async update(id: string, dto: UpdateProjectDto, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Project not found');
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
        cadence: dto.cadence,
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
  listAssignableUsers() {
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['PM', 'TEAM_LEAD', 'EMPLOYEE'] } },
      select: { id: true, name: true, email: true, role: true, resourceType: true },
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
      const pm = await this.prisma.user.count({ where: { id: pmId } });
      if (!pm) throw new NotFoundException('PM not found');
    }
    if (clientId) {
      const client = await this.prisma.user.count({ where: { id: clientId, role: 'CLIENT' } });
      if (!client) throw new NotFoundException('Client not found');
    }
  }
}
