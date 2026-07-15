'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { cn, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, type Me } from '@/lib/api';
import { clearToken, getToken } from '@/lib/session';

// Portal top-nav only, no sidebar (Spec §16.2).
const NAV = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Approvals', href: '/approvals' },
  { label: 'Invoices', href: '/invoices' },
  { label: 'Profile', href: '/profile' },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <div className="min-h-screen">
      {/* Skip link (WCAG 2.4.1): keyboard users bypass the nav straight to content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                R
              </span>
              <span className="hidden text-base font-bold tracking-tight text-slate-900 sm:inline">Rademics</span>
              <span className="hidden rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400 sm:inline">
                Portal
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {me.email.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-sm text-slate-500">{me.email}</span>
            </div>
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
