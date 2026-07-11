import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import type { CreateDepartmentDto, CreateSkillTagDto, CreateTeamDto } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Departments, Teams and Skill tags (Spec §5.2, §5.9, §23 Org). */
@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Departments ──
  async listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { teams: true, members: true } } },
    });
  }

  async createDepartment(dto: CreateDepartmentDto, actor: AuthUser, meta: Meta) {
    try {
      const dept = await this.prisma.department.create({
        data: { name: dto.name.trim(), vertical: dto.vertical },
      });
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'DEPARTMENT_CREATED',
        entityType: 'Department',
        entityId: dept.id,
        after: { name: dept.name, vertical: dept.vertical },
        ...meta,
      });
      return dept;
    } catch (err) {
      throw uniqueOrThrow(err, 'A department with this name already exists');
    }
  }

  // ── Teams ──
  async listTeams() {
    return this.prisma.team.findMany({
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: {
        department: { select: { id: true, name: true, vertical: true } },
        teamLead: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
    });
  }

  async createTeam(dto: CreateTeamDto, actor: AuthUser, meta: Meta) {
    const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!dept) throw new NotFoundException('Department not found');

    if (dto.teamLeadId) {
      const lead = await this.prisma.user.findUnique({ where: { id: dto.teamLeadId } });
      if (!lead) throw new NotFoundException('Team lead user not found');
    }

    try {
      const team = await this.prisma.team.create({
        data: {
          name: dto.name.trim(),
          departmentId: dto.departmentId,
          teamLeadId: dto.teamLeadId ?? null,
        },
      });
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'TEAM_CREATED',
        entityType: 'Team',
        entityId: team.id,
        after: { name: team.name, departmentId: team.departmentId, teamLeadId: team.teamLeadId },
        ...meta,
      });
      return team;
    } catch (err) {
      throw uniqueOrThrow(err, 'A team with this name already exists in the department');
    }
  }

  // ── Skill tags ──
  async listSkills() {
    return this.prisma.skillTag.findMany({ orderBy: { name: 'asc' } });
  }

  async createSkill(dto: CreateSkillTagDto, actor: AuthUser, meta: Meta) {
    try {
      const skill = await this.prisma.skillTag.create({ data: { name: dto.name.trim() } });
      await this.audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: 'SKILL_TAG_CREATED',
        entityType: 'SkillTag',
        entityId: skill.id,
        after: { name: skill.name },
        ...meta,
      });
      return skill;
    } catch (err) {
      throw uniqueOrThrow(err, 'This skill tag already exists');
    }
  }
}

function uniqueOrThrow(err: unknown, message: string): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ConflictException(message);
  }
  return err instanceof Error ? err : new Error('Unknown error');
}
