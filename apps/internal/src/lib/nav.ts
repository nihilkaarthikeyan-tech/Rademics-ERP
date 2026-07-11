import type { Role } from '@rademics/permissions';

/**
 * Internal app sidebar (Spec §16.1). `roles` gates visibility at the nav level;
 * the API still enforces every capability (Spec §3, §10) — this is cosmetic.
 */
export interface NavItem {
  label: string;
  href: string;
  roles: Role[] | 'all';
}

const ALL: 'all' = 'all';

export const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', roles: ALL },
  { label: 'My Work', href: '/my-work', roles: ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
  { label: 'People', href: '/people', roles: ['SUPER_ADMIN', 'HR'] },
  { label: 'Attendance', href: '/attendance', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD'] },
  { label: 'Projects', href: '/projects', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
  { label: 'Leave', href: '/leave', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
  { label: 'Finance', href: '/finance', roles: ['SUPER_ADMIN', 'FINANCE'] },
  { label: 'Reports', href: '/reports', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
  { label: 'AI Assistant', href: '/assistant', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'] },
  { label: 'Admin', href: '/admin', roles: ['SUPER_ADMIN'] },
];

export function navForRole(role: string): NavItem[] {
  return NAV.filter((n) => n.roles === 'all' || (n.roles as string[]).includes(role));
}
