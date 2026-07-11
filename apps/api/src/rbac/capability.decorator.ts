import { SetMetadata } from '@nestjs/common';
import type { CapabilityKey } from '@rademics/permissions';

export const CAPABILITY_KEY_META = 'rbac:capability';

/**
 * Declare the capability an endpoint requires (Spec §3, enforced at the API — §10).
 *
 * Fail-closed convention: every non-public, business endpoint must declare a
 * capability with this decorator. The CapabilityGuard denies by default.
 */
export const RequireCapability = (capability: CapabilityKey) =>
  SetMetadata(CAPABILITY_KEY_META, capability);
