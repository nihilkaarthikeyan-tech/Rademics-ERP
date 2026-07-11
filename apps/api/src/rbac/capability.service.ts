import { Injectable } from '@nestjs/common';
import {
  Grant,
  ResourceType,
  isFreelancerStrippedCapability,
  type Role,
} from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves capability grants from the DB-backed matrix (Spec §3), which Super Admin
 * can edit without a code change. The seed comes from @rademics/permissions.
 *
 * Fail-closed (§10): an unknown role/capability resolves to DENY.
 */
@Injectable()
export class CapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveGrant(
    role: Role,
    resourceType: ResourceType,
    capabilityKey: string,
  ): Promise<Grant> {
    // Hard freelancer rule (§3) overrides any configured grant.
    if (role === 'EMPLOYEE' && resourceType === ResourceType.FREELANCE) {
      if (isFreelancerStrippedCapability(capabilityKey)) return Grant.DENY;
    }

    const row = await this.prisma.roleCapability.findUnique({
      where: { role_capabilityKey: { role, capabilityKey } },
      select: { grant: true },
    });

    return (row?.grant as Grant | undefined) ?? Grant.DENY;
  }
}
