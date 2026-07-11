/**
 * Roles & resource types — Spec §2, §3.
 *
 * There are exactly SEVEN roles. A user has exactly one role (§2).
 * "Freelancer" is NOT a role: it is an EMPLOYEE with resourceType = FREELANCE
 * (§2: "the same user type distinguished by a resource type flag"), and it
 * "inherits the Employee column minus every Attendance and Leave capability" (§3).
 */

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR: 'HR',
  PM: 'PM',
  TEAM_LEAD: 'TEAM_LEAD',
  EMPLOYEE: 'EMPLOYEE',
  CLIENT: 'CLIENT',
  FINANCE: 'FINANCE',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Column order of the §3 matrix. Do not reorder — the seed strings depend on it. */
export const ROLE_ORDER: readonly Role[] = [
  Role.SUPER_ADMIN,
  Role.HR,
  Role.PM,
  Role.TEAM_LEAD,
  Role.EMPLOYEE,
  Role.CLIENT,
  Role.FINANCE,
] as const;

export const ALL_ROLES: readonly Role[] = ROLE_ORDER;

/** Internal staff vs. external freelancer (§2, §5.2). */
export const ResourceType = {
  INTERNAL: 'INTERNAL',
  FREELANCE: 'FREELANCE',
} as const;

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];
