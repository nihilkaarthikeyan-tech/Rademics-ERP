import type { Role } from '@rademics/permissions';
import {
  LayoutDashboard,
  ListTodo,
  Users,
  Clock,
  FolderKanban,
  CalendarDays,
  CalendarRange,
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
  /** Built but switched off for now: kept in the code, left out of every menu. */
  hidden?: boolean;
}

const ALL: 'all' = 'all';

export const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', roles: ALL, icon: LayoutDashboard, group: 'Workspace' },
  { label: 'My Work', href: '/my-work', roles: ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: ListTodo, group: 'Workspace' },
  { label: 'Notices', href: '/notices', roles: ALL, icon: Megaphone, group: 'Workspace' },
  { label: 'Chat', href: '/chat', roles: ALL, icon: MessagesSquare, group: 'Workspace' },
  { label: 'Attendance', href: '/attendance', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Clock, group: 'Workspace' },
  { label: 'Leave', href: '/leave', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: CalendarDays, group: 'Workspace' },
  { label: 'Calendar', href: '/calendar', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: CalendarRange, group: 'Workspace' },
  { label: 'Desktop Agent', href: '/desktop-agent', roles: ALL, icon: Monitor, group: 'Workspace' },
  { label: 'Projects', href: '/projects', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: FolderKanban, group: 'Manage' },
  { label: 'People', href: '/people', roles: ['SUPER_ADMIN', 'HR'], icon: Users, group: 'Manage' },
  // Two different screens on purpose: "My clients" is a staff to-do list keyed
  // by CL-code, "Clients" is Super Admin administration where names live.
  { label: 'My clients', href: '/my-clients', roles: ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Handshake, group: 'Workspace' },
  { label: 'Clients', href: '/clients', roles: ['SUPER_ADMIN'], icon: Building2, group: 'Manage' },
  { label: 'Finance', href: '/finance', roles: ['SUPER_ADMIN', 'FINANCE'], icon: Wallet, group: 'Manage' },
  { label: 'Reports', href: '/reports', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: BarChart3, group: 'Insights' },
  // Hidden 2026-10-09 (owner's call): the assistant is kept, not removed — set
  // hidden: false (and drop the redirect in app/(app)/assistant/page.tsx) to bring it back.
  { label: 'AI Assistant', href: '/assistant', roles: ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'], icon: Sparkles, group: 'Insights', hidden: true },
  { label: 'Admin', href: '/admin', roles: ['SUPER_ADMIN'], icon: Settings, group: 'Manage' },
  { label: 'Audit Log', href: '/audit', roles: ['SUPER_ADMIN'], icon: ScrollText, group: 'Manage' },
];

export function navForRole(role: string): NavItem[] {
  return NAV.filter((n) => !n.hidden && (n.roles === 'all' || (n.roles as string[]).includes(role)));
}

export const NAV_GROUPS: NavItem['group'][] = ['Workspace', 'Manage', 'Insights'];

/**
 * Two-level navigation: the left icon rail shows these sections; a section with
 * more than one of the role's pages opens a panel of those pages beside the rail.
 * Every NAV item belongs to exactly one section, so nothing is dropped, and
 * visibility per role still comes from NAV's `roles`.
 */
export interface RailSection {
  label: string;
  icon: LucideIcon;
  hrefs: string[];
}

export const RAIL: RailSection[] = [
  { label: 'Dashboard', icon: LayoutDashboard, hrefs: ['/dashboard'] },
  { label: 'Notices', icon: Megaphone, hrefs: ['/notices'] },
  { label: 'Chat', icon: MessagesSquare, hrefs: ['/chat'] },
  { label: 'Work', icon: ListTodo, hrefs: ['/my-work', '/projects', '/my-clients'] },
  { label: 'Attendance', icon: Clock, hrefs: ['/attendance', '/leave', '/calendar', '/desktop-agent'] },
  { label: 'People', icon: Users, hrefs: ['/people'] },
  { label: 'Finance', icon: Wallet, hrefs: ['/finance'] },
  { label: 'Reports', icon: BarChart3, hrefs: ['/reports'] },
  { label: 'AI Assistant', icon: Sparkles, hrefs: ['/assistant'] },
  { label: 'Admin', icon: Settings, hrefs: ['/admin', '/clients', '/audit'] },
];

export interface RailEntry {
  section: RailSection;
  items: NavItem[];
}

/** The rail for a role: sections with at least one visible item, items in section order. */
export function railForRole(role: string): RailEntry[] {
  const visible = navForRole(role);
  return RAIL.map((section) => ({
    section,
    items: section.hrefs
      .map((href) => visible.find((n) => n.href === href))
      .filter((n): n is NavItem => Boolean(n)),
  })).filter((e) => e.items.length > 0);
}

export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}
