import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClientAdminService } from './client-admin.service';

/**
 * The cross-client boundary (2026-07-27).
 *
 * The portal's read path authorises purely from ClientProjectAccess rows and
 * never re-checks the org, so grantAccess is the only thing standing between
 * two clients' data. These cases pin that: one mis-picked user id must not be
 * enough to hand a client another client's project.
 */

const ACME_ORG = 'acme-org-id';
const NORTHWIND_ORG = 'northwind-org-id';

function makeService(project: { id: string; clientOrgId: string | null }, user: {
  id: string;
  role: string;
  clientOrgId: string | null;
}) {
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue(project),
      update: vi.fn().mockResolvedValue(project),
    },
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    clientProjectAccess: { upsert: vi.fn().mockResolvedValue({ id: 'access-id' }) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ClientAdminService(prisma as never, audit as never, {} as never);
  return { service, prisma };
}

const actor = { id: 'sa-id', email: 'sa@rademics.local' } as never;
const meta = { ip: null, userAgent: null };

describe('grantAccess — cross-client boundary', () => {
  it('refuses a project that belongs to a different client', async () => {
    const { service, prisma } = makeService(
      { id: 'project-1', clientOrgId: NORTHWIND_ORG },
      { id: 'acme-user', role: 'CLIENT', clientOrgId: ACME_ORG },
    );

    await expect(
      service.grantAccess('project-1', { projectId: 'project-1', clientUserId: 'acme-user' }, actor, meta),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The refusal must happen before any row is written.
    expect(prisma.clientProjectAccess.upsert).not.toHaveBeenCalled();
  });

  it('allows a second user from the same client onto their own project', async () => {
    const { service, prisma } = makeService(
      { id: 'project-1', clientOrgId: ACME_ORG },
      { id: 'acme-user-2', role: 'CLIENT', clientOrgId: ACME_ORG },
    );

    await expect(
      service.grantAccess('project-1', { projectId: 'project-1', clientUserId: 'acme-user-2' }, actor, meta),
    ).resolves.toEqual({ id: 'access-id' });

    expect(prisma.clientProjectAccess.upsert).toHaveBeenCalledOnce();
  });

  it('binds an unassigned project to the granting client', async () => {
    const { service, prisma } = makeService(
      { id: 'project-1', clientOrgId: null },
      { id: 'acme-user', role: 'CLIENT', clientOrgId: ACME_ORG },
    );

    await service.grantAccess('project-1', { projectId: 'project-1', clientUserId: 'acme-user' }, actor, meta);

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { clientOrgId: ACME_ORG },
    });
  });

  it('refuses a non-client user, so staff cannot be given portal access', async () => {
    const { service, prisma } = makeService(
      { id: 'project-1', clientOrgId: null },
      { id: 'employee-id', role: 'EMPLOYEE', clientOrgId: null },
    );

    await expect(
      service.grantAccess('project-1', { projectId: 'project-1', clientUserId: 'employee-id' }, actor, meta),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.clientProjectAccess.upsert).not.toHaveBeenCalled();
  });
});
