import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Grant } from '@rademics/permissions';
import { CapabilityGuard } from './capability.guard';
import { CAPABILITY_KEY_META, CAPABILITY_SCOPED_META } from './capability.decorator';
import type { CapabilityService } from './capability.service';
import type { AuthUser } from '../auth/auth-user';

function makeContext(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(capability: string | undefined, grant: Grant, scopeAllowed = false) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === CAPABILITY_SCOPED_META ? scopeAllowed : capability,
    ),
  } as unknown as Reflector;
  // reference the key constant so a rename keeps this in sync
  void CAPABILITY_KEY_META;
  const capabilities = { resolveGrant: vi.fn().mockResolvedValue(grant) } as unknown as CapabilityService;
  return new CapabilityGuard(reflector, capabilities);
}

const employee: AuthUser = {
  id: 'u1',
  email: 'e@rademics.local',
  role: 'EMPLOYEE',
  resourceType: 'INTERNAL',
};

describe('CapabilityGuard (Spec §3, §10 — enforced at the API)', () => {
  it('passes routes with no declared capability', async () => {
    const guard = makeGuard(undefined, Grant.DENY);
    await expect(guard.canActivate(makeContext(employee))).resolves.toBe(true);
  });

  it('allows when the grant is ALLOW', async () => {
    const guard = makeGuard('attendance.check_in_out', Grant.ALLOW);
    await expect(guard.canActivate(makeContext(employee))).resolves.toBe(true);
  });

  it('DENIES (403) when the grant is DENY — the core RBAC denial', async () => {
    const guard = makeGuard('admin.settings.manage', Grant.DENY);
    await expect(guard.canActivate(makeContext(employee))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed (403) on SCOPED when the route did not opt into self-scoping', async () => {
    const guard = makeGuard('attendance.team.view', Grant.SCOPED, false);
    await expect(guard.canActivate(makeContext(employee))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes SCOPED when the route opts into self-scoping (handler enforces scope)', async () => {
    const guard = makeGuard('attendance.team.view', Grant.SCOPED, true);
    await expect(guard.canActivate(makeContext(employee))).resolves.toBe(true);
  });

  it('rejects (401) a capability-guarded route with no authenticated user', async () => {
    const guard = makeGuard('admin.settings.manage', Grant.ALLOW);
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
