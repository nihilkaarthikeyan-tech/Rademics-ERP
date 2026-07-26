/**
 * Roles & resource types — Spec §2, §3.
 *
 * There are exactly SIX roles. A user has exactly one role (§2).
 * "Freelancer" is NOT a role: it is an EMPLOYEE with resourceType = FREELANCE
 * (§2: "the same user type distinguished by a resource type flag"), and it
 * "inherits the Employee column minus every Attendance and Leave capability" (§3).
 *
 * PM is NOT a role (2026-07-25 decision). Project authority is an APPOINTMENT:
 * HR/Super Admin name someone in a project's `pmId`, and that person gets the
 * project's task/file/expense powers for THAT project only — see
 * `assertProjectAuthority` in tasks.service.ts. Anyone can be appointed
 * regardless of role, and removing them from the field removes the powers.
 */

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR: 'HR',
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
