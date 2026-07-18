import type { Role } from '@rademics/permissions';
import {
  LayoutDashboard,
  ListTodo,
  Users,
  Clock,
  FolderKanban,
  CalendarDays,
  Wallet,
  BarChart3,
  Sparkles,
  Settings,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

/**
 * Internal app sidebar (Spec §16.1). `roles` gates visibility at the nav level;
 * the API still enforces every capability (Spec §3, §10) — this is cosmetic.
 */
export interface NavItem {
  label: string;
  href: string;
  roles: Role[] | 'all';
  icon: LucideIcon;
  group: 'Workspace' | 'Manage' | 'Insights';
}

const ALL: 'all' = 'all';

export const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', roles: ALL, icon: LayoutDashboard, group: 'Workspace' },
  { label: 'My Work', href: '/my-work', roles: ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: ListTodo, group: 'Workspace' },
  { label: 'Attendance', href: '/attendance', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Clock, group: 'Workspace' },
  { label: 'Leave', href: '/leave', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: CalendarDays, group: 'Workspace' },
  { label: 'Projects', href: '/projects', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: FolderKanban, group: 'Manage' },
  { label: 'People', href: '/people', roles: ['SUPER_ADMIN', 'HR'], icon: Users, group: 'Manage' },
  { label: 'Finance', href: '/finance', roles: ['SUPER_ADMIN', 'FINANCE'], icon: Wallet, group: 'Manage' },
  { label: 'Reports', href: '/reports', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: BarChart3, group: 'Insights' },
  { label: 'AI Assistant', href: '/assistant', roles: ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Sparkles, group: 'Insights' },
  { label: 'Admin', href: '/admin', roles: ['SUPER_ADMIN'], icon: Settings, group: 'Manage' },
  { label: 'Audit Log', href: '/audit', roles: ['SUPER_ADMIN'], icon: ScrollText, group: 'Manage' },
];

export function navForRole(role: string): NavItem[] {
  return NAV.filter((n) => n.roles === 'all' || (n.roles as string[]).includes(role));
}

export const NAV_GROUPS: NavItem['group'][] = ['Workspace', 'Manage', 'Insights'];
