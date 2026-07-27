import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
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
    private readonly notifications: NotificationsService,
  ) {}

  // ── Directory list (Spec §19 table standards) ──
  async list(query: ListEmployeesQuery, viewer?: AuthUser) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      resourceType: query.resourceType,
      departmentId: query.departmentId,
      teamId: query.teamId,
    };
    // This is the STAFF directory. Client users are people too, so without this
    // `?role=CLIENT` returned every client's name and email to any employee —
    // the whole client list, enumerable in one request. Only Super Admin, who
    // administers clients, may see them here.
    // (A `?role=CLIENT` request then contradicts itself and returns nothing,
    // which is the right answer rather than an error that confirms they exist.)
    if (viewer?.role !== 'SUPER_ADMIN') {
      where.NOT = { role: 'CLIENT' };
    }
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

  // ── Single employee (Spec §3). Salary feature removed 2026-07-27 (user decision):
  //    the column stays in the schema but is never read or written from the app. ──
  async get(id: string, requester: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: DIRECTORY_SELECT,
    });
    if (!user) throw new NotFoundException('Employee not found');
    // Same boundary as the list: knowing a client's id must not be a way around
    // it. 404 rather than 403 — a 403 would confirm the client exists.
    if (user.role === 'CLIENT' && requester.role !== 'SUPER_ADMIN') {
      throw new NotFoundException('Employee not found');
    }

    return flattenSkills(user);
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
    const TERMINAL = ['COMPLETED', 'CLOSED', 'CANCELLED'] as const;
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

  /**
   * Role change (people.roles.assign — Super Admin only per the matrix).
   * Guards: never your own role (no self-escalation, no locking yourself out),
   * never to/from CLIENT (client accounts are org-bound, made by onboarding).
   * Sessions are revoked so the new role applies at next login, not in 15 min.
   */
  async setRole(id: string, role: string, actor: AuthUser, meta: Meta) {
    if (id === actor.id) throw new BadRequestException('You cannot change your own role');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true },
    });
    if (!user) throw new NotFoundException('Employee not found');
    if (user.role === 'CLIENT') throw new BadRequestException('Client accounts cannot be converted to staff');
    if (user.role === role) return { id, role, changed: false };

    await this.prisma.user.update({ where: { id }, data: { role: role as never } });
    await this.auth.revokeAllForUser(id);

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'ROLE_CHANGED',
      entityType: 'User',
      entityId: id,
      before: { role: user.role },
      after: { role },
      ...meta,
    });
    return { id, role, changed: true };
  }

  // ── helpers ──
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
