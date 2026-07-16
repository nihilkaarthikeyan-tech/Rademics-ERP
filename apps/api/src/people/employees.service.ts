import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { EncryptionService } from '../crypto/encryption.service';
import { CapabilityService } from '../rbac/capability.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';
import type { CreateEmployeeDto, ListEmployeesQuery, UpdateEmployeeDto } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const DIRECTORY_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  resourceType: true,
  status: true,
  employmentStatus: true,
  phone: true,
  employeeCode: true,
  loginCode: true, // anonymized login/handle for client-facing employees (shown to SA/HR)
  joinDate: true,
  activeEngagement: true,
  department: { select: { id: true, name: true, vertical: true } },
  team: { select: { id: true, name: true } },
  reportingManager: { select: { id: true, name: true, email: true } },
  skills: { select: { skill: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly encryption: EncryptionService,
    private readonly capabilities: CapabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Directory list (Spec §19 table standards) ──
  async list(query: ListEmployeesQuery) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      resourceType: query.resourceType,
      departmentId: query.departmentId,
      teamId: query.teamId,
    };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map(flattenSkills),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ── Single employee, salary gated per matrix (Spec §3) ──
  async get(id: string, requester: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...DIRECTORY_SELECT, salaryCiphertext: true },
    });
    if (!user) throw new NotFoundException('Employee not found');

    const canViewSalary = await this.canViewSalary(requester);
    const { salaryCiphertext, ...rest } = user;
    return {
      ...flattenSkills(rest),
      salary: canViewSalary ? this.encryption.decryptNullable(salaryCiphertext) : undefined,
      salaryVisible: canViewSalary,
    };
  }

  // ── Create + invite (Spec §5.2) ──
  async create(dto: CreateEmployeeDto, actor: AuthUser, meta: Meta) {
    if (dto.joinDate && new Date(dto.joinDate) > new Date()) {
      throw new BadRequestException('Join date cannot be in the future');
    }
    await this.assertRefsExist(dto.departmentId, dto.teamId, dto.reportingManagerId);

    // Reuse the invite flow (account + set-password email + audit USER_INVITED).
    const { id } = await this.auth.invite(
      actor,
      { email: dto.email, name: dto.name, role: dto.role, resourceType: dto.resourceType },
      meta,
    );

    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          phone: dto.phone ?? null,
          employeeCode: dto.employeeCode ?? null,
          joinDate: dto.joinDate ? new Date(dto.joinDate) : null,
          employmentStatus: 'ACTIVE',
          departmentId: dto.departmentId ?? null,
          teamId: dto.teamId ?? null,
          reportingManagerId: dto.reportingManagerId ?? null,
          skills: dto.skillIds?.length
            ? { create: dto.skillIds.map((skillId) => ({ skillId })) }
            : undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Employee code already in use');
      }
      throw err;
    }

    return this.get(id, actor);
  }

  // ── Update (Spec §24: manager cannot be self / create a cycle) ──
  async update(id: string, dto: UpdateEmployeeDto, actor: AuthUser, meta: Meta) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Employee not found');

    if (dto.joinDate && new Date(dto.joinDate) > new Date()) {
      throw new BadRequestException('Join date cannot be in the future');
    }
    if (dto.reportingManagerId) {
      if (dto.reportingManagerId === id) {
        throw new BadRequestException('An employee cannot report to themselves');
      }
      await this.assertNoManagerCycle(id, dto.reportingManagerId);
    }
    await this.assertRefsExist(dto.departmentId, dto.teamId, dto.reportingManagerId);

    await this.prisma.$transaction(async (tx) => {
      if (dto.skillIds) {
        await tx.userSkill.deleteMany({ where: { userId: id } });
      }
      await tx.user.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          reportingManagerId: dto.reportingManagerId,
          employmentStatus: dto.employmentStatus,
          joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined,
          skills: dto.skillIds?.length
            ? { create: dto.skillIds.map((skillId) => ({ skillId })) }
            : undefined,
        },
      });
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'EMPLOYEE_UPDATED',
      entityType: 'User',
      entityId: id,
      after: { fields: Object.keys(dto) },
      ...meta,
    });

    return this.get(id, actor);
  }

  // ── Deactivate / offboard (Spec §5.2, §25) ──
  async deactivate(id: string, actor: AuthUser, meta: Meta) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Employee not found');
    if (user.status === 'DEACTIVATED') return { id, status: user.status };

    await this.prisma.user.update({
      where: { id },
      data: { status: 'DEACTIVATED', employmentStatus: 'EXITED', activeEngagement: false },
    });
    // Immediately revoke sessions (Spec §5.2).
    await this.auth.revokeAllForUser(id);
    const reassigned = await this.reassignOpenTasks(id, actor);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: id,
      before: { status: user.status },
      after: { status: 'DEACTIVATED', tasksReassigned: reassigned },
      ...meta,
    });
    return { id, status: 'DEACTIVATED', tasksReassigned: reassigned };
  }

  /**
   * On deactivation, open tasks auto-return to ASSIGNED with the assignee cleared,
   * and the project PM is notified (Spec §25). History is preserved (immutable §6).
   */
  private async reassignOpenTasks(userId: string, actor: AuthUser): Promise<number> {
    const TERMINAL = ['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED'] as const;
    const open = await this.prisma.task.findMany({
      where: { assigneeId: userId, status: { notIn: [...TERMINAL] } },
      select: { id: true, title: true, status: true, project: { select: { pmId: true } } },
    });

    for (const task of open) {
      await this.prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: task.id },
          data: { assigneeId: null, status: 'ASSIGNED' },
        });
        await tx.taskStatusHistory.create({
          data: {
            taskId: task.id,
            fromStatus: task.status,
            toStatus: 'ASSIGNED',
            action: 'REASSIGN',
            actorId: actor.id,
            actorEmail: actor.email,
            comment: 'Auto-returned to the assignment pool on assignee deactivation (§25)',
          },
        });
      });
      await this.notifications.notify({
        userId: task.project.pmId ?? '',
        type: 'TASK_UNASSIGNED',
        eventGroup: 'tasks',
        title: 'A task needs reassignment',
        body: `${task.title} returned to the pool after its assignee was deactivated`,
        entityType: 'Task',
        entityId: task.id,
      });
    }
    return open.length;
  }

  // ── Salary (encrypted at rest; audited without the value) ──
  async setSalary(id: string, salary: string, actor: AuthUser, meta: Meta) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('Employee not found');

    await this.prisma.user.update({
      where: { id },
      data: { salaryCiphertext: this.encryption.encrypt(salary) },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SALARY_EDIT',
      entityType: 'User',
      entityId: id,
      after: { changed: true }, // never log the salary value itself
      ...meta,
    });
    return { id, updated: true };
  }

  // ── helpers ──
  private async canViewSalary(user: AuthUser): Promise<boolean> {
    const grant = await this.capabilities.resolveGrant(
      user.role,
      user.resourceType,
      'people.salary.view_edit',
    );
    return grant !== Grant.DENY;
  }

  private async assertRefsExist(
    departmentId?: string,
    teamId?: string,
    managerId?: string,
  ): Promise<void> {
    if (departmentId) {
      const d = await this.prisma.department.count({ where: { id: departmentId } });
      if (!d) throw new NotFoundException('Department not found');
    }
    if (teamId) {
      const t = await this.prisma.team.count({ where: { id: teamId } });
      if (!t) throw new NotFoundException('Team not found');
    }
    if (managerId) {
      const m = await this.prisma.user.count({ where: { id: managerId } });
      if (!m) throw new NotFoundException('Reporting manager not found');
    }
  }

  private async assertNoManagerCycle(employeeId: string, managerId: string): Promise<void> {
    let current: string | null = managerId;
    const seen = new Set<string>([employeeId]);
    while (current) {
      if (seen.has(current)) {
        throw new BadRequestException('Reporting manager change would create a cycle');
      }
      seen.add(current);
      const next: { reportingManagerId: string | null } | null =
        await this.prisma.user.findUnique({
          where: { id: current },
          select: { reportingManagerId: true },
        });
      current = next?.reportingManagerId ?? null;
    }
  }
}

function flattenSkills<T extends { skills: { skill: { id: string; name: string } }[] }>(u: T) {
  const { skills, ...rest } = u;
  return { ...rest, skills: skills.map((s) => s.skill) };
}
