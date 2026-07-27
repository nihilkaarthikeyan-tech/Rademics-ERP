import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth-user';
import { formatClientCode, formatProjectCode } from '@rademics/types';
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

  async listOrgs() {
    // Ordered by number, not name: a reserved client ID has no name yet, and
    // sorting by it would scatter the reservations unpredictably. The code is
    // also the stable thing — a client can be renamed, CL-008 cannot.
    const orgs = await this.prisma.clientOrg.findMany({
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        _count: { select: { users: true, projects: true } },
      },
    });
    return orgs.map((o) => ({
      ...o,
      code: formatClientCode(o.number),
      // No name means the ID was reserved when a project was marked as client
      // work, and nobody has created the account yet. Surfaced so outstanding
      // reservations are visible rather than silently accumulating.
      awaitingAccount: o.name === null,
    }));
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
   * Projects that can still be given to a client: not yet bound to one, and not
   * closed. The onboarding form picks from this rather than asking anyone to
   * type a code — nobody remembers RAD-007, and a typo there is the one mistake
   * that hands a client another client's work. Presenting only the free
   * projects makes the wrong answer unreachable instead of merely validated.
   */
  async assignableProjects() {
    const projects = await this.prisma.project.findMany({
      where: { clientOrgId: null, status: { not: 'CLOSED' } },
      select: { id: true, number: true, name: true, status: true },
      orderBy: { number: 'asc' },
    });
    return projects.map((p) => ({ ...p, code: formatProjectCode(p.number) }));
  }

  /**
   * Resolve project numbers to projects. Still used to re-check a selection
   * server-side, and kept forgiving so a code pasted from an email resolves
   * the same way the picker would.
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
   * Create the client's account against the client ID reserved when their
   * project was created. Both codes are required and must agree.
   *
   * Requiring the pair is the point: a client ID alone, or a project number
   * alone, can be mistyped into somebody else's. Demanding both means a single
   * wrong character produces a mismatch and a refusal rather than an account
   * quietly attached to another client's work.
   *
   * All-or-nothing — any failure aborts before anything is written. A
   * half-onboarded client looks fine on screen while showing the wrong set of
   * work.
   */
  async onboardClient(dto: OnboardClientDto, actor: AuthUser, meta: Meta) {
    const clientCode = formatClientCode(dto.clientNumber);
    const org = await this.prisma.clientOrg.findUnique({
      where: { number: dto.clientNumber },
      select: { id: true, number: true, name: true, status: true },
    });
    if (!org) throw new BadRequestException(`No client with ID ${clientCode}`);
    if (org.name !== null) {
      throw new ConflictException(`${clientCode} already has an account (${org.name})`);
    }
    if (org.status === 'DEACTIVATED') {
      throw new BadRequestException(`${clientCode} has been deactivated`);
    }

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
    // The pairing check. A project reserved for a DIFFERENT client ID, or never
    // marked as client work at all, is refused — the two codes must describe
    // the same thing.
    const mismatched = projects.filter((p) => p.clientOrgId !== org.id);
    if (mismatched.length > 0) {
      throw new BadRequestException(
        `${mismatched.map((p) => formatProjectCode(p.number)).join(', ')} ` +
          `${mismatched.length === 1 ? 'is' : 'are'} not held by ${clientCode}`,
      );
    }

    const name = dto.name.trim();
    const { id: userId } = await this.auth.invite(
      actor,
      { email: dto.email, name, role: 'CLIENT', resourceType: 'INTERNAL' },
      meta,
    );

    try {
      await this.prisma.$transaction([
        // Naming the reservation is what turns it into a real client.
        this.prisma.clientOrg.update({ where: { id: org.id }, data: { name } }),
        this.prisma.user.update({ where: { id: userId }, data: { clientOrgId: org.id } }),
        this.prisma.clientProjectAccess.createMany({
          data: projects.map((p) => ({ projectId: p.id, clientUserId: userId })),
          skipDuplicates: true,
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A client named "${name}" already exists`);
      }
      throw err;
    }

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
      clientCode,
      userId,
      email: dto.email,
      projects: projects.map((p) => ({ code: formatProjectCode(p.number), name: p.name })),
    };
  }

  /**
   * Resolve a typed client ID + project codes for the form's confirmation
   * panel, so the Super Admin sees what the codes mean before submitting
   * rather than only finding out from a rejection.
   */
  async verifyPairing(clientNumber: number | null, projectNumbers: number[]) {
    const org = clientNumber
      ? await this.prisma.clientOrg.findUnique({
          where: { number: clientNumber },
          select: { id: true, number: true, name: true, status: true },
        })
      : null;

    const projects = await this.prisma.project.findMany({
      where: { number: { in: [...new Set(projectNumbers)] } },
      select: { id: true, number: true, name: true, clientOrgId: true },
    });

    return {
      client: org
        ? {
            code: formatClientCode(org.number),
            found: true as const,
            // A reservation still waiting for its account — the only state an
            // account may be created against.
            available: org.name === null && org.status === 'ACTIVE',
            takenBy: org.name,
          }
        : { code: clientNumber ? formatClientCode(clientNumber) : null, found: false as const },
      projects: [...new Set(projectNumbers)].map((n) => {
        const p = projects.find((x) => x.number === n);
        if (!p) return { number: n, code: formatProjectCode(n), found: false as const };
        return {
          number: n,
          code: formatProjectCode(n),
          found: true as const,
          name: p.name,
          matchesClient: org ? p.clientOrgId === org.id : false,
        };
      }),
    };
  }

  /**
   * The clients a staff member is actually working for.
   *
   * Scoped to projects they run or hold a task in — the same "own project" rule
   * the projects list uses — so this is a view of their own workload, not a
   * directory of the company's clients. Super Admin and HR, who run every
   * project, see all of them.
   *
   * Identity is never included: a client is CL-012 here, whatever the viewer's
   * role, because only Super Admin sees names and this screen is for everyone
   * else. What it adds is the state a staff member needs to act on — how long
   * the client has been waiting, and whether they have asked.
   */
  async myClients(user: AuthUser) {
    const seesEverything = user.role === 'SUPER_ADMIN' || user.role === 'HR';
    const projects = await this.prisma.project.findMany({
      where: {
        clientOrgId: { not: null },
        ...(seesEverything
          ? {}
          : { OR: [{ pmId: user.id }, { tasks: { some: { assigneeId: user.id } } }] }),
      },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        clientOrg: { select: { id: true, number: true, name: true, status: true } },
        tasks: {
          where: { clientFacing: true, status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] } },
          select: {
            id: true,
            title: true,
            createdAt: true,
            lastClientUpdateAt: true,
            lastStatusRequestAt: true,
          },
        },
      },
      orderBy: { number: 'asc' },
    });

    const now = Date.now();
    const DAY = 86_400_000;
    // One row per client, not per project — a client with five quiet tasks is
    // one thing to deal with, not five.
    const byClient = new Map<string, {
      clientId: string;
      code: string;
      status: string;
      projects: { id: string; code: string; name: string }[];
      openClientTasks: number;
      daysSinceUpdate: number | null;
      waitingSince: string | null;
      pendingRequests: { taskId: string; title: string; askedAt: Date }[];
    }>();

    for (const p of projects) {
      if (!p.clientOrg) continue;
      const key = p.clientOrg.id;
      const row = byClient.get(key) ?? {
        clientId: p.clientOrg.id,
        code: formatClientCode(p.clientOrg.number),
        status: p.clientOrg.status,
        projects: [],
        openClientTasks: 0,
        daysSinceUpdate: null,
        waitingSince: null,
        pendingRequests: [],
      };
      row.projects.push({ id: p.id, code: formatProjectCode(p.number), name: p.name });
      row.openClientTasks += p.tasks.length;

      for (const t of p.tasks) {
        // The oldest silence across their tasks is what matters: that is how
        // long this client has actually gone without hearing anything.
        const since = t.lastClientUpdateAt ?? t.createdAt;
        const days = Math.floor((now - since.getTime()) / DAY);
        if (row.daysSinceUpdate === null || days > row.daysSinceUpdate) {
          row.daysSinceUpdate = days;
          row.waitingSince = since.toISOString();
        }
        // A request counts as pending until an update goes out after it.
        const answered = t.lastClientUpdateAt && t.lastStatusRequestAt
          ? t.lastClientUpdateAt > t.lastStatusRequestAt
          : false;
        if (t.lastStatusRequestAt && !answered) {
          row.pendingRequests.push({ taskId: t.id, title: t.title, askedAt: t.lastStatusRequestAt });
        }
      }
      byClient.set(key, row);
    }

    return [...byClient.values()]
      .map((r) => ({ ...r, updateDue: (r.daysSinceUpdate ?? 0) >= 3 && r.openClientTasks > 0 }))
      // Anything asked for, or overdue, first — this is a to-do list.
      .sort((a, b) => {
        if (a.pendingRequests.length !== b.pendingRequests.length) {
          return b.pendingRequests.length - a.pendingRequests.length;
        }
        return (b.daysSinceUpdate ?? -1) - (a.daysSinceUpdate ?? -1);
      });
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
