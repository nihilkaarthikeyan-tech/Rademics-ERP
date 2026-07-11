/**
 * @rademics/permissions — single source of truth for the Role & Permission Matrix (Spec §3).
 *
 * The API layer resolves a grant to one of ALLOW / DENY / SCOPED. SCOPED means
 * "allowed only for own team / own projects / own record" — the concrete scope
 * predicate is applied by the API guard, not here (§3 scoped definitions).
 */

export * from './roles.js';
export * from './capabilities.js';
export * from './matrix.js';

import { CapabilityGroup, type CapabilityKey, CAPABILITIES } from './capabilities.js';
import { Grant, PERMISSION_MATRIX } from './matrix.js';
import { Role, ResourceType } from './roles.js';

const GROUP_BY_KEY: Record<CapabilityKey, CapabilityGroup> = Object.fromEntries(
  CAPABILITIES.map((c) => [c.key, c.group]),
) as Record<CapabilityKey, CapabilityGroup>;

/** The group a capability belongs to, or undefined for an unknown key. */
export function getCapabilityGroup(capability: string): CapabilityGroup | undefined {
  return GROUP_BY_KEY[capability as CapabilityKey];
}

/**
 * Freelancer rule (§3): a freelancer is an EMPLOYEE with resourceType = FREELANCE and
 * "inherits the Employee column minus every Attendance and Leave capability."
 *
 * This is a hard rule independent of any DB-configured grant.
 */
export function isFreelancerStrippedCapability(capability: string): boolean {
  const group = GROUP_BY_KEY[capability as CapabilityKey];
  return group === CapabilityGroup.ATTENDANCE || group === CapabilityGroup.LEAVE;
}

function isStrippedForFreelancer(capability: CapabilityKey): boolean {
  return isFreelancerStrippedCapability(capability);
}

/**
 * Resolve the seed grant for a (role, resourceType) against a capability.
 * Returns ALLOW / DENY / SCOPED. This reflects the seed state; production reads
 * the DB-backed grants (which start as a copy of this seed) instead.
 *
 * Note: SCOPED still requires the caller to verify the concrete scope. Treat SCOPED
 * as "not yet allowed" until the scope predicate passes (fail closed, §10).
 */
export function resolveGrant(
  role: Role,
  resourceType: ResourceType,
  capability: CapabilityKey,
): Grant {
  if (role === Role.EMPLOYEE && resourceType === ResourceType.FREELANCE) {
    if (isStrippedForFreelancer(capability)) return Grant.DENY;
  }
  const grants = PERMISSION_MATRIX[capability];
  return grants ? grants[role] : Grant.DENY;
}

export interface AccessSubject {
  role: Role;
  resourceType: ResourceType;
}

/** True only for an unconditional ALLOW (SCOPED must be checked separately). */
export function hasUnscopedCapability(subject: AccessSubject, capability: CapabilityKey): boolean {
  return resolveGrant(subject.role, subject.resourceType, capability) === Grant.ALLOW;
}

/** True if the capability is at least SCOPED for the subject (needs a scope check to actually allow). */
export function isScopedCapability(subject: AccessSubject, capability: CapabilityKey): boolean {
  return resolveGrant(subject.role, subject.resourceType, capability) === Grant.SCOPED;
}
