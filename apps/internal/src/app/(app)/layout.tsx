'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { cn, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, type Me } from '@/lib/api';
import { clearToken, getToken } from '@/lib/session';
import { navForRole, NAV_GROUPS } from '@/lib/nav';
import { MeContext } from '@/lib/me-context';
import { AttendanceProvider } from '@/lib/attendance-context';
import { NotificationsBell } from '@/components/notifications-bell';
import { GlobalSearch } from '@/components/global-search';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR: 'HR',
  PM: 'Project Manager',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
  CLIENT: 'Client',
  FINANCE: 'Finance',
};

function initials(nameOrEmail: string): string {
  const base = (nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail) ?? '';
  const parts = base.replace(/[._-]+/g, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

function displayName(email: string): string {
  const base = email.split('@')[0] ?? email;
  return base
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    apiFetch<Me>('/auth/me')
      .then((m) => {
        setMe(m);
        setStatus('ready');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace('/login');
        } else {
          setStatus('error');
        }
      });
  }, [router]);

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearToken();
    router.replace('/login');
  }

  if (status !== 'ready' || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  const items = navForRole(me.role);
  const roleLabel = ROLE_LABELS[me.role] ?? me.role;

  return (
    <MeContext.Provider value={me}>
    <AttendanceProvider>
      {/* Skip link (WCAG 2.4.1): keyboard users bypass the nav straight to content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        {/* ── Sidebar ── */}
        <aside className="glass-chrome hidden w-64 shrink-0 flex-col border-r border-white/50 sm:flex">
          <div className="flex h-16 items-center gap-2 px-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-xs font-bold text-white shadow-[0_8px_18px_-6px_rgba(124,108,246,0.7)]">
              R
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Rademics</span>
            <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              ERP
            </span>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
            {NAV_GROUPS.map((group) => {
              const groupItems = items.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {groupItems.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(item.href + '/');
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            active
                              ? 'bg-gradient-to-r from-accent-soft to-accent-soft/40 font-semibold text-primary before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-gradient-to-b before:from-[#7C6CF6] before:to-[#A855F7]'
                              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-slate-400')} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* User block */}
          <div className="border-t border-white/50 p-3">
            <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
                {initials(displayName(me.email))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{displayName(me.email)}</div>
                <div className="truncate text-xs text-slate-400">{roleLabel}</div>
              </div>
              <button
                onClick={logout}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass-chrome sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/50 px-6">
            <GlobalSearch />
            <div className="flex items-center gap-3">
              <NotificationsBell />
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium text-slate-700">{displayName(me.email)}</div>
                <div className="text-xs text-slate-400">{roleLabel}</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-xs font-semibold text-white sm:hidden">
                {initials(displayName(me.email))}
              </div>
            </div>
          </header>

          <main id="main-content" className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AttendanceProvider>
    </MeContext.Provider>
  );
}
