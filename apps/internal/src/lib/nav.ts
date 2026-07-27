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
  Building2,
  Handshake,
  Monitor,
  Megaphone,
  MessagesSquare,
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
  { label: 'My Work', href: '/my-work', roles: ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: ListTodo, group: 'Workspace' },
  { label: 'Notices', href: '/notices', roles: ALL, icon: Megaphone, group: 'Workspace' },
  { label: 'Chat', href: '/chat', roles: ALL, icon: MessagesSquare, group: 'Workspace' },
  { label: 'Attendance', href: '/attendance', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Clock, group: 'Workspace' },
  { label: 'Leave', href: '/leave', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: CalendarDays, group: 'Workspace' },
  { label: 'Desktop Agent', href: '/desktop-agent', roles: ALL, icon: Monitor, group: 'Workspace' },
  { label: 'Projects', href: '/projects', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: FolderKanban, group: 'Manage' },
  { label: 'People', href: '/people', roles: ['SUPER_ADMIN', 'HR'], icon: Users, group: 'Manage' },
  // Two different screens on purpose: "My clients" is a staff to-do list keyed
  // by CL-code, "Clients" is Super Admin administration where names live.
  { label: 'My clients', href: '/my-clients', roles: ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Handshake, group: 'Workspace' },
  { label: 'Clients', href: '/clients', roles: ['SUPER_ADMIN'], icon: Building2, group: 'Manage' },
  { label: 'Finance', href: '/finance', roles: ['SUPER_ADMIN', 'FINANCE'], icon: Wallet, group: 'Manage' },
  { label: 'Reports', href: '/reports', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: BarChart3, group: 'Insights' },
  { label: 'AI Assistant', href: '/assistant', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Sparkles, group: 'Insights' },
  { label: 'Admin', href: '/admin', roles: ['SUPER_ADMIN'], icon: Settings, group: 'Manage' },
  { label: 'Audit Log', href: '/audit', roles: ['SUPER_ADMIN'], icon: ScrollText, group: 'Manage' },
];

export function navForRole(role: string): NavItem[] {
  return NAV.filter((n) => n.roles === 'all' || (n.roles as string[]).includes(role));
}

export const NAV_GROUPS: NavItem['group'][] = ['Workspace', 'Manage', 'Insights'];
