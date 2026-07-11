'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, LogOut, Search } from 'lucide-react';
import { cn, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, type Me } from '@/lib/api';
import { clearToken, getToken } from '@/lib/session';
import { navForRole } from '@/lib/nav';
import { MeContext } from '@/lib/me-context';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR: 'HR',
  PM: 'Project Manager',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
  CLIENT: 'Client',
  FINANCE: 'Finance',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen">
        {/* Sidebar (Spec §16.1) */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white sm:flex">
          <div className="flex h-14 items-center px-5 text-lg font-bold text-brand-navy">
            Rademics
          </div>
          <nav className="flex flex-col gap-0.5 px-3 py-2">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar (Spec §16.1) */}
          <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Search…</span>
            </div>
            <div className="flex items-center gap-4">
              <Bell className="h-5 w-5 text-slate-400" />
              <div className="text-right">
                <div className="text-sm font-medium text-slate-700">{me.email}</div>
                <div className="text-xs text-slate-400">{ROLE_LABELS[me.role] ?? me.role}</div>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
