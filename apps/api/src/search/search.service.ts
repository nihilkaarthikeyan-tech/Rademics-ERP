import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityService } from '../rbac/capability.service';
import type { AuthUser } from '../auth/auth-user';

const TAKE = 6;

export interface SearchResults {
  tasks: { id: string; title: string; projectId: string; projectName: string; status: string }[];
  projects: { id: string; name: string }[];
  /**
   * Every staff member can find a colleague (name, role, online). `email` is only
   * included for callers who may see the staff directory; nobody else gets it.
   */
  people: { id: string; name: string; role: string; online: boolean; email?: string }[];
  /** Notices are for all staff, so every staff member can search them. */
  notices: { id: string; title: string; excerpt: string; createdAt: Date }[];
}

/**
 * Global header search (2026-07-24). Deliberately reuses the SAME capability
 * grants and project-scoping shape as TasksService.resolveViewScope /
 * ownProjectFilter (projects.view_all / projects.view_own_team) rather than
 * inventing new rules — a search result must never reveal something the same
 * user couldn't already open directly. Each section degrades to an empty array
 * (not a 403) when the caller lacks that capability, so one restricted section
 * doesn't fail the whole search.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
  ) {}

  async search(q: string, user: AuthUser): Promise<SearchResults> {
    const query = q.trim();
    if (query.length < 2) return { tasks: [], projects: [], people: [], notices: [] };

    const [tasks, projects, people, notices] = await Promise.all([
      this.searchTasks(query, user),
      this.searchProjects(query, user),
      this.searchPeople(query, user),
      this.searchNotices(query, user),
    ]);
    return { tasks, projects, people, notices };
  }

  /** null = no task/project surface at all (e.g. CLIENT — they use the portal). */
  private async projectScopeFilter(user: AuthUser): Promise<Prisma.ProjectWhereInput | null> {
    if (user.role === 'CLIENT') return null;
    const all = await this.capabilities.resolveGrant(user.role, user.resourceType, 'projects.view_all');
    if (all === Grant.ALLOW) return {};
    const own = await this.capabilities.resolveGrant(user.role, user.resourceType, 'projects.view_own_team');
    if (own === Grant.ALLOW || own === Grant.SCOPED) {
      return { OR: [{ pmId: user.id }, { tasks: { some: { assigneeId: user.id } } }] };
    }
    return null;
  }

  private async searchTasks(q: string, user: AuthUser): Promise<SearchResults['tasks']> {
    const scope = await this.projectScopeFilter(user);
    if (scope === null) return [];
    const tasks = await this.prisma.task.findMany({
      where: { title: { contains: q, mode: 'insensitive' }, project: scope },
      select: { id: true, title: true, status: true, projectId: true, project: { select: { name: true } } },
      take: TAKE,
    });
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      projectId: t.projectId,
      projectName: t.project.name,
      status: t.status,
    }));
  }

  private async searchProjects(q: string, user: AuthUser): Promise<SearchResults['projects']> {
    const scope = await this.projectScopeFilter(user);
    if (scope === null) return [];
    return this.prisma.project.findMany({
      where: { name: { contains: q, mode: 'insensitive' }, ...scope },
      select: { id: true, name: true },
      take: TAKE,
    });
  }

  /**
   * Find a colleague. All staff get name, role and whether they are checked in
   * right now — the same things the chat already shows everyone. Email (and
   * matching on it) only for callers who may view the staff directory. Clients
   * never search people here.
   */
  private async searchPeople(q: string, user: AuthUser): Promise<SearchResults['people']> {
    if (user.role === 'CLIENT') return [];
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, 'people.directory.view');
    const directory = grant === Grant.ALLOW;
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { not: 'CLIENT' },
        OR: directory
          ? [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }]
          : [{ name: { contains: q, mode: 'insensitive' } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        attendanceSessions: { where: { checkOutAt: null }, select: { id: true }, take: 1 },
      },
      orderBy: { name: 'asc' },
      take: TAKE,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      online: r.attendanceSessions.length > 0,
      ...(directory ? { email: r.email } : {}),
    }));
  }

  /** Notices whose title or text contains the words, newest first. Staff only. */
  private async searchNotices(q: string, user: AuthUser): Promise<SearchResults['notices']> {
    if (user.role === 'CLIENT') return [];
    const rows = await this.prisma.announcement.findMany({
      where: {
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, title: true, body: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
    });
    return rows.map((n) => {
      // Show the words around the match, not just the opening line.
      const at = n.body.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, at - 40);
      const slice = n.body.slice(start, start + 140).replace(/\s+/g, ' ').trim();
      return { id: n.id, title: n.title, excerpt: `${start > 0 ? '…' : ''}${slice}`, createdAt: n.createdAt };
    });
  }
}
