import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth-user';
import type { CreateClientOrgDto, CreateClientUserDto, GrantAccessDto } from './dto';

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

    const { id, loginCode } = await this.auth.invite(
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
    // loginCode is what the client uses to sign in — surfaced to the Super Admin so
    // they can hand it over; the client's email is never shown to the worker side.
    return { id, email: dto.email, orgId, loginCode };
  }

  /** Grant a client user Viewer/Approver access to a project (§5.5). */
  async grantAccess(projectId: string, dto: GrantAccessDto, actor: AuthUser, meta: Meta) {
    const [project, clientUser] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, clientOrgId: true } }),
      this.prisma.user.findUnique({ where: { id: dto.clientUserId }, select: { id: true, role: true, clientOrgId: true } }),
    ]);
    if (!project) throw new NotFoundException('Project not found');
    if (!clientUser || clientUser.role !== 'CLIENT' || !clientUser.clientOrgId) {
      throw new BadRequestException('That user is not a client-org user');
    }

    const access = await this.prisma.clientProjectAccess.upsert({
      where: { projectId_clientUserId: { projectId, clientUserId: dto.clientUserId } },
      update: { level: dto.level },
      create: { projectId, clientUserId: dto.clientUserId, level: dto.level },
    });
    // Bind the project to the client's org on first grant.
    if (!project.clientOrgId) {
      await this.prisma.project.update({ where: { id: projectId }, data: { clientOrgId: clientUser.clientOrgId } });
    }
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email,
      action: 'CLIENT_ACCESS_GRANTED', entityType: 'ClientProjectAccess', entityId: access.id,
      after: { projectId, clientUserId: dto.clientUserId, level: dto.level }, ...meta,
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
