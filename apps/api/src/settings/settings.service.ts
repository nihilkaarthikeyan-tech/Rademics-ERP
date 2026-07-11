import { Injectable } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import { PERMISSION_MATRIX } from '@rademics/permissions';
import type { Grant as PrismaGrant, Role as PrismaRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const BUSINESS_RULES_KEY = 'business_rules';

/** Admin Settings (Spec §4, §23) + Role-Permission editor (Spec §3, §23). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getBusinessRules(): Promise<Record<string, unknown>> {
    const row = await this.prisma.setting.findUnique({ where: { key: BUSINESS_RULES_KEY } });
    return (row?.value as Record<string, unknown>) ?? { ...DEFAULT_BUSINESS_RULES };
  }

  async updateBusinessRules(
    patch: Record<string, unknown>,
    actor: AuthUser,
    meta: Meta,
  ): Promise<Record<string, unknown>> {
    const before = await this.getBusinessRules();
    const merged = { ...before, ...patch };
    await this.prisma.setting.upsert({
      where: { key: BUSINESS_RULES_KEY },
      update: { value: merged as object, updatedById: actor.id },
      create: { key: BUSINESS_RULES_KEY, value: merged as object, updatedById: actor.id },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'SETTING_CHANGED',
      entityType: 'Setting',
      entityId: BUSINESS_RULES_KEY,
      before: { keys: Object.keys(patch) },
      after: patch,
      ...meta,
    });
    return merged;
  }

  /** Current role-capability grants (seed = Spec §3), grouped by role. */
  async getRolePermissions() {
    const rows = await this.prisma.roleCapability.findMany({
      orderBy: [{ role: 'asc' }, { capabilityKey: 'asc' }],
      select: { role: true, capabilityKey: true, grant: true },
    });
    return rows;
  }

  async updateRolePermission(
    role: PrismaRole,
    capabilityKey: string,
    grant: PrismaGrant,
    actor: AuthUser,
    meta: Meta,
  ) {
    // Guard against unknown capability keys (fail closed — Spec §10).
    if (!(capabilityKey in PERMISSION_MATRIX)) {
      throw new Error(`Unknown capability key: ${capabilityKey}`);
    }
    const before = await this.prisma.roleCapability.findUnique({
      where: { role_capabilityKey: { role, capabilityKey } },
      select: { grant: true },
    });
    const updated = await this.prisma.roleCapability.upsert({
      where: { role_capabilityKey: { role, capabilityKey } },
      update: { grant },
      create: { role, capabilityKey, grant },
    });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'ROLE_PERMISSION_CHANGED',
      entityType: 'RoleCapability',
      entityId: `${role}:${capabilityKey}`,
      before: { grant: before?.grant ?? null },
      after: { grant },
      ...meta,
    });
    return updated;
  }
}
