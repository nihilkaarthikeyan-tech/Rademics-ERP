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
  people: { id: string; name: string; email: string; role: string }[];
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
    if (query.length < 2) return { tasks: [], projects: [], people: [] };

    const [tasks, projects, people] = await Promise.all([
      this.searchTasks(query, user),
      this.searchProjects(query, user),
      this.searchPeople(query, user),
    ]);
    return { tasks, projects, people };
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

  private async searchPeople(q: string, user: AuthUser): Promise<SearchResults['people']> {
    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, 'people.directory.view');
    if (grant !== Grant.ALLOW) return [];
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { not: 'CLIENT' },
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, name: true, email: true, role: true },
      take: TAKE,
    });
  }
}
