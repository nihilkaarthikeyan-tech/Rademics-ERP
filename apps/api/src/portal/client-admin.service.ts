import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth-user';
import { formatProjectCode } from '@rademics/types';
import type { CreateClientOrgDto, CreateClientUserDto, GrantAccessDto, OnboardClientDto } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Internal-side client administration (Spec §2, §5.5) — gated by portal.users.manage. */
@Injectable()
export class ClientAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async createOrg(dto: CreateClientOrgDto, actor: AuthUser, meta: Meta) {
    try {
      const org = await this.prisma.clientOrg.create({ data: { name: dto.name.trim() } });
      await this.audit.record({
        actorId: actor.id, actorEmail: actor.email,
        action: 'CLIENT_ORG_CREATED', entityType: 'ClientOrg', entityId: org.id,
        after: { name: org.name }, ...meta,
      });
      return org;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A client organization with that name already exists');
      }
      throw err;
    }
  }

  listOrgs() {
    return this.prisma.clientOrg.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true, _count: { select: { users: true, projects: true } } },
    });
  }

  /** Invite a client user into an org (individual login + scope — §2). */
  async createClientUser(orgId: string, dto: CreateClientUserDto, actor: AuthUser, meta: Meta) {
    const org = await this.prisma.clientOrg.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new NotFoundException('Client organization not found');

    const { id } = await this.auth.invite(
      actor,
      { email: dto.email, name: dto.name, role: 'CLIENT', resourceType: 'INTERNAL' },
      meta,
    );
    await this.prisma.user.update({ where: { id }, data: { clientOrgId: orgId } });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email,
      action: 'CLIENT_USER_CREATED', entityType: 'User', entityId: id,
      after: { orgId, email: dto.email }, ...meta,
    });
    return { id, email: dto.email, orgId };
  }

  /**
   * Resolve project numbers to projects, for the confirmation step in the
   * onboarding form: the Super Admin types codes and sees the project NAMES
   * back before saving. Typing 12 instead of 13 is the one mistake that hands a
   * client someone else's work, and a number carries nothing a human can
   * sanity-check — so the name is shown, always, before anything is written.
   */
  async lookupProjects(numbers: number[]) {
    const unique = [...new Set(numbers)];
    const found = await this.prisma.project.findMany({
      where: { number: { in: unique } },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        clientOrgId: true,
        clientOrg: { select: { id: true, name: true } },
      },
    });
    const byNumber = new Map(found.map((p) => [p.number, p]));
    return unique.map((n) => {
      const p = byNumber.get(n);
      return p
        ? {
            number: n,
            code: formatProjectCode(n),
            found: true as const,
            id: p.id,
            name: p.name,
            status: p.status,
            // Surfaced so the form can warn BEFORE submitting that a project is
            // already another client's — the server refuses it either way.
            takenBy: p.clientOrg ? { id: p.clientOrg.id, name: p.clientOrg.name } : null,
          }
        : { number: n, code: formatProjectCode(n), found: false as const };
    });
  }

  /**
   * Create a client and give them their projects in one step.
   *
   * All-or-nothing: an unknown or already-taken project number aborts the whole
   * thing rather than creating a half-onboarded client with some of their
   * access. A half-grant is the failure mode that looks fine on screen and
   * silently shows the client the wrong set of work.
   */
  async onboardClient(dto: OnboardClientDto, actor: AuthUser, meta: Meta) {
    const numbers = [...new Set(dto.projectNumbers)];
    const projects = await this.prisma.project.findMany({
      where: { number: { in: numbers } },
      select: { id: true, number: true, name: true, clientOrgId: true },
    });

    const missing = numbers.filter((n) => !projects.some((p) => p.number === n));
    if (missing.length > 0) {
      throw new BadRequestException(
        `No project with ${missing.length === 1 ? 'code' : 'codes'} ${missing.map(formatProjectCode).join(', ')}`,
      );
    }
    // A project already bound to another client cannot be re-pointed here; see
    // the same check in grantAccess.
    const taken = projects.filter((p) => p.clientOrgId !== null);
    if (taken.length > 0) {
      throw new BadRequestException(
        `Already assigned to another client: ${taken.map((p) => formatProjectCode(p.number)).join(', ')}`,
      );
    }

    const name = dto.name.trim();
    // The org is an implementation detail of the portal's scoping, so it takes
    // the client's own name. Collisions are surfaced as a duplicate-client
    // error because that is what a repeated name actually means here.
    let org;
    try {
      org = await this.prisma.clientOrg.create({ data: { name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A client named "${name}" already exists`);
      }
      throw err;
    }

    const { id: userId } = await this.auth.invite(
      actor,
      { email: dto.email, name, role: 'CLIENT', resourceType: 'INTERNAL' },
      meta,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { clientOrgId: org.id } }),
      this.prisma.clientProjectAccess.createMany({
        data: projects.map((p) => ({ projectId: p.id, clientUserId: userId })),
        skipDuplicates: true,
      }),
      this.prisma.project.updateMany({
        where: { id: { in: projects.map((p) => p.id) } },
        data: { clientOrgId: org.id },
      }),
    ]);

    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email,
      action: 'CLIENT_ONBOARDED', entityType: 'User', entityId: userId,
      after: {
        orgId: org.id,
        email: dto.email,
        projects: projects.map((p) => formatProjectCode(p.number)),
      },
      ...meta,
    });

    return {
      orgId: org.id,
      userId,
      email: dto.email,
      projects: projects.map((p) => ({ code: formatProjectCode(p.number), name: p.name })),
    };
  }

  /** Grant a client user access to a project (§5.5) — view + request-status only. */
  async grantAccess(projectId: string, dto: GrantAccessDto, actor: AuthUser, meta: Meta) {
    const [project, clientUser] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, clientOrgId: true } }),
      this.prisma.user.findUnique({ where: { id: dto.clientUserId }, select: { id: true, role: true, clientOrgId: true } }),
    ]);
    if (!project) throw new NotFoundException('Project not found');
    if (!clientUser || clientUser.role !== 'CLIENT' || !clientUser.clientOrgId) {
      throw new BadRequestException('That user is not a client-org user');
    }
    // The tenant boundary. Without this a single mis-picked user id hands one
    // client another client's project, and nothing downstream catches it: the
    // portal's read path authorises purely from these access rows and never
    // re-checks the org. A project already bound to an org is therefore closed
    // to every other org, permanently.
    if (project.clientOrgId && project.clientOrgId !== clientUser.clientOrgId) {
      throw new BadRequestException('That project belongs to a different client');
    }

    const access = await this.prisma.clientProjectAccess.upsert({
      where: { projectId_clientUserId: { projectId, clientUserId: dto.clientUserId } },
      update: {},
      create: { projectId, clientUserId: dto.clientUserId },
    });
    // Bind the project to the client's org on first grant.
    if (!project.clientOrgId) {
      await this.prisma.project.update({ where: { id: projectId }, data: { clientOrgId: clientUser.clientOrgId } });
    }
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email,
      action: 'CLIENT_ACCESS_GRANTED', entityType: 'ClientProjectAccess', entityId: access.id,
      after: { projectId, clientUserId: dto.clientUserId }, ...meta,
    });
    return access;
  }

  /** Deactivate an org → "access ended" for all its users + sessions revoked (§25). */
  async deactivateOrg(orgId: string, actor: AuthUser, meta: Meta) {
    const org = await this.prisma.clientOrg.findUnique({
      where: { id: orgId },
      select: { id: true, status: true, users: { select: { id: true } } },
    });
    if (!org) throw new NotFoundException('Client organization not found');
    if (org.status === 'DEACTIVATED') return { id: orgId, status: org.status };

    await this.prisma.clientOrg.update({ where: { id: orgId }, data: { status: 'DEACTIVATED' } });
    await Promise.all(org.users.map((u) => this.auth.revokeAllForUser(u.id)));
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email,
      action: 'CLIENT_ORG_DEACTIVATED', entityType: 'ClientOrg', entityId: orgId,
      after: { usersRevoked: org.users.length }, ...meta,
    });
    return { id: orgId, status: 'DEACTIVATED' };
  }
}
