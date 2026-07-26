import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Grant } from '@rademics/permissions';
import { TasksService } from './tasks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CapabilityService } from '../rbac/capability.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';

/**
 * Project authority (2026-07-25) — the security boundary that replaced the PM role.
 *
 * Two independent ways to act on a project's tasks:
 *   1. your ROLE holds the capability outright (HR / Super Admin), or
 *   2. you are the person APPOINTED to that project (Project.pmId).
 *
 * The danger this guards against is (2) leaking sideways: being appointed to one
 * project must never grant anything on another.
 */

const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

function user(role: AuthUser['role'], id = 'u-appointee'): AuthUser {
  return { id, email: `${id}@rademics.local`, role, resourceType: 'INTERNAL', desktopCheckInRequired: false };
}

/**
 * `grant` is what the caller's ROLE resolves to; `appointedTo` is the project
 * they are recorded against, mirroring `project.count({ where: { id, pmId } })`.
 */
function makeService(grant: Grant, appointedTo: string | null, appointeeId = 'u-appointee') {
  const prisma = {
    project: {
      count: vi.fn(async ({ where }: { where: { id: string; pmId: string } }) =>
        where.id === appointedTo && where.pmId === appointeeId ? 1 : 0,
      ),
      findUnique: vi.fn(async () => ({ id: PROJECT_A })),
    },
    task: {
      findUnique: vi.fn(async () => ({ projectId: PROJECT_A })),
    },
    checklistItem: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: 'c1' })) },
  } as unknown as PrismaService;

  const capabilities = { resolveGrant: vi.fn().mockResolvedValue(grant) } as unknown as CapabilityService;
  const audit = { record: vi.fn() } as unknown as AuditService;
  const notifications = { notify: vi.fn(), notifyMany: vi.fn() } as unknown as NotificationsService;

  return new TasksService(prisma, audit, capabilities, notifications);
}

/** Reaches the private check directly — it is the whole point of this suite. */
function authorityOf(service: TasksService) {
  return (
    service as unknown as {
      assertProjectAuthority(u: AuthUser, projectId: string, cap: string): Promise<void>;
    }
  ).assertProjectAuthority.bind(service);
}

describe('assertProjectAuthority — role OR appointment', () => {
  it('allows a role that holds the capability outright (HR / Super Admin)', async () => {
    const check = authorityOf(makeService(Grant.ALLOW, null));
    await expect(check(user('HR'), PROJECT_A, 'tasks.assign')).resolves.toBeUndefined();
  });

  it('allows the appointed manager on their own project, whatever their role', async () => {
    const check = authorityOf(makeService(Grant.DENY, PROJECT_A));
    await expect(check(user('EMPLOYEE'), PROJECT_A, 'tasks.assign')).resolves.toBeUndefined();
  });

  it('does NOT let an appointment leak to another project', async () => {
    // Appointed to A, acting on B — the exact hole a role-only check would miss.
    const check = authorityOf(makeService(Grant.DENY, PROJECT_A));
    await expect(check(user('EMPLOYEE'), PROJECT_B, 'tasks.assign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an ordinary employee who is appointed to nothing', async () => {
    const check = authorityOf(makeService(Grant.DENY, null));
    await expect(check(user('EMPLOYEE'), PROJECT_A, 'tasks.create')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not treat a SCOPED role grant as permission on its own', async () => {
    // TEAM_LEAD is SCOPED on tasks.assign. Scope resolution for leads was never
    // built, so it must keep failing closed rather than silently becoming ALLOW.
    const check = authorityOf(makeService(Grant.SCOPED, null));
    await expect(check(user('TEAM_LEAD'), PROJECT_A, 'tasks.assign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('checklist items respect the same boundary', () => {
  it('rejects an outsider adding a checklist item', async () => {
    const service = makeService(Grant.DENY, null);
    await expect(
      service.addChecklistItem('task-1', { text: 'x' }, user('EMPLOYEE')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the appointed manager add one', async () => {
    const service = makeService(Grant.DENY, PROJECT_A);
    await expect(
      service.addChecklistItem('task-1', { text: 'x' }, user('EMPLOYEE')),
    ).resolves.toEqual({ id: 'c1' });
  });

  it('404s on a task that does not exist, before any authority check', async () => {
    const service = makeService(Grant.ALLOW, null);
    (service as unknown as { prisma: { task: { findUnique: ReturnType<typeof vi.fn> } } }).prisma.task.findUnique =
      vi.fn(async () => null);
    await expect(
      service.addChecklistItem('missing', { text: 'x' }, user('HR')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
