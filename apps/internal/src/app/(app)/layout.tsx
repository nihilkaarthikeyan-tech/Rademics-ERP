'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, LogOut, Menu, Monitor, X } from 'lucide-react';
import { cn, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, type Me } from '@/lib/api';
import { clearToken } from '@/lib/session';
import { railForRole, isActiveHref, type RailEntry } from '@/lib/nav';
import { MeContext } from '@/lib/me-context';
import { AttendanceProvider } from '@/lib/attendance-context';
import { NotificationsBell } from '@/components/notifications-bell';
import { MyWorkBadge } from '@/components/my-work-badge';
import { ChatBadge } from '@/components/chat-badge';
import { GlobalSearch } from '@/components/global-search';
import { desktopHost } from '@/lib/desktop-host';
import { ChatNotifier } from '@/components/chat-notifier';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR: 'HR',
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

/** Unread counts belong to a page; the rail shows them on the section holding it. */
function badgeFor(href: string) {
  if (href === '/my-work') return <MyWorkBadge />;
  if (href === '/chat') return <ChatBadge />;
  return null;
}

/** Your name in the top bar: details, the desktop app and Sign out, on every screen. */
function AccountMenu({ me, roleLabel, onLogout }: { me: Me; roleLabel: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = displayName(me.email);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 items-center gap-2.5 rounded-md py-1 pl-1 pr-2 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9D4F0] text-xs font-semibold text-[#1B2A4A]">
          {initials(name)}
        </span>
        <span className="hidden leading-tight sm:block">
          <span className="block text-sm font-medium text-white">{name}</span>
          <span className="block text-xs text-white/60">{roleLabel}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-white/60 sm:block" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="glass-panel absolute right-0 top-12 z-40 w-64 p-1.5 text-slate-900 shadow-lg">
          <div className="px-3 py-2.5">
            <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
            <div className="truncate text-xs text-slate-500">{me.email}</div>
            <div className="mt-0.5 text-xs text-slate-500">{roleLabel}</div>
          </div>
          <div className="my-1 h-px bg-slate-200" />
          <Link
            role="menuitem"
            href="/desktop-agent"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-accent-soft"
          >
            <Monitor className="h-4 w-4 text-slate-400" aria-hidden />
            Desktop Agent
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-accent-soft"
          >
            <LogOut className="h-4 w-4 text-slate-400" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [navOpen, setNavOpen] = useState(false);

  // Tapping a nav link on a phone should land you on the page, not leave the
  // drawer covering it.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    // No early no-token redirect: even with an empty localStorage, apiFetch's
    // 401→refresh-cookie→retry path can restore the session (7-day cookie).
    apiFetch<Me>('/auth/me')
      .then((m) => {
        setMe(m);
        setStatus('ready');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          // Inside the desktop app the session belongs to the app, not this page.
          if (desktopHost()) setStatus('error');
          else router.replace('/login');
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

  // Inside the desktop app's chat window: just the page, no website chrome.
  if (desktopHost()) {
    return (
      <MeContext.Provider value={me}>
        <main id="main-content" className="h-dvh p-3">
          {children}
        </main>
      </MeContext.Provider>
    );
  }

  const rail = railForRole(me.role);
  const roleLabel = ROLE_LABELS[me.role] ?? me.role;
  const activeEntry: RailEntry | undefined = rail.find((e) => e.items.some((i) => isActiveHref(pathname, i.href)));
  // The section panel appears only for a section with several pages (Work, Attendance, Admin).
  const panelEntry = activeEntry && activeEntry.items.length > 1 ? activeEntry : undefined;

  return (
    <MeContext.Provider value={me}>
    <AttendanceProvider>
      <ChatNotifier />
      {/* Skip link (WCAG 2.4.1): keyboard users bypass the nav straight to content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* ── App bar (Teams-style): navy, logo on a white chip, search in the middle,
            notifications and account (with Sign out) on the right ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-[#1B2A4A] px-3 text-white sm:px-4">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          className="shrink-0 rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white sm:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link
          href="/dashboard"
          aria-label="Rademics, go to the dashboard"
          className="flex shrink-0 items-center rounded-md bg-white px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rademics-logo.png" alt="Rademics" width={68} height={48} className="h-9 w-auto" />
        </Link>
        <div className="flex min-w-0 flex-1 justify-center">
          <GlobalSearch />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <NotificationsBell onDark />
          <AccountMenu me={me} roleLabel={roleLabel} onLogout={logout} />
        </div>
      </header>

      <div className="flex">
        {/* ── Level 1: icon rail ── */}
        <nav
          aria-label="Main menu"
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[84px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-rail px-1.5 py-2 sm:flex"
        >
          {rail.map(({ section, items }) => {
            const active = activeEntry?.section.label === section.label;
            const Icon = section.icon;
            const first = items[0]!;
            return (
              <Link
                key={section.label}
                href={first.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-md px-1 pb-2 pt-2.5 text-center text-[11.5px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'bg-white font-semibold text-accent shadow-glass'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                )}
              >
                {active ? <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r bg-accent" aria-hidden /> : null}
                <Icon className={cn('h-[22px] w-[22px]', active ? 'text-accent' : 'text-slate-500')} aria-hidden />
                {section.label}
                <span className="absolute right-1.5 top-1 empty:hidden">
                  {items.map((i) => (
                    <Fragment key={i.href}>{badgeFor(i.href)}</Fragment>
                  ))}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* ── Level 2: the pages inside a multi-page section ── */}
        {panelEntry ? (
          <nav
            aria-label={panelEntry.section.label}
            className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 md:flex"
          >
            <h2 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {panelEntry.section.label}
            </h2>
            {panelEntry.items.map((item) => {
              const active = isActiveHref(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'bg-accent-soft font-semibold text-accent'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-slate-400')} aria-hidden />
                  {item.label}
                  {badgeFor(item.href)}
                </Link>
              );
            })}
          </nav>
        ) : null}

        {/* ── Mobile nav drawer: every section and page in one list ── */}
        {navOpen ? (
          <div className="fixed inset-0 z-40 sm:hidden">
            <div className="absolute inset-0 bg-slate-900/30" onClick={() => setNavOpen(false)} aria-hidden="true" />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white shadow-2xl">
              <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/rademics-logo.png" alt="Rademics" width={68} height={48} className="h-12 w-auto" />
                <button onClick={() => setNavOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav aria-label="Main menu" className="flex flex-col gap-3 p-3">
                {rail.map(({ section, items }) => (
                  <div key={section.label}>
                    {items.length > 1 ? (
                      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.label}</div>
                    ) : null}
                    {items.map((item) => {
                      const active = isActiveHref(pathname, item.href);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                            active ? 'bg-accent-soft font-semibold text-accent' : 'text-slate-600 hover:bg-slate-100',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-slate-400')} aria-hidden />
                          {item.label}
                          {badgeFor(item.href)}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </aside>
          </div>
        ) : null}

        <main id="main-content" className="min-w-0 flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </AttendanceProvider>
    </MeContext.Provider>
  );
}
