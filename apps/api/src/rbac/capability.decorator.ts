import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { CapabilityKey } from '@rademics/permissions';

export const CAPABILITY_KEY_META = 'rbac:capability';
export const CAPABILITY_SCOPED_META = 'rbac:capabilityScoped';

/**
 * Declare the capability an endpoint requires (Spec §3, enforced at the API — §10).
 *
 * Fail-closed convention: every non-public, business endpoint must declare a
 * capability with this decorator. The CapabilityGuard denies by default.
 */
export const RequireCapability = (capability: CapabilityKey) =>
  SetMetadata(CAPABILITY_KEY_META, capability);

/**
 * Declare a capability whose grant may be SCOPED (Spec §3, cross-cutting #3).
 *
 * A SCOPED grant means "own team / own record" — the row-level filtering lives in
 * the service, NOT the guard. This marker tells CapabilityGuard that reaching the
 * handler with a SCOPED grant is intentional; the handler MUST then restrict the
 * result set to the caller's scope. ALLOW still passes; DENY (and SCOPED without
 * this marker) still fail closed.
 */
export const RequireScopedCapability = (capability: CapabilityKey) =>
  applyDecorators(
    SetMetadata(CAPABILITY_KEY_META, capability),
    SetMetadata(CAPABILITY_SCOPED_META, true),
  );
