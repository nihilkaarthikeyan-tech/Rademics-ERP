'use client';

import { useMe } from '@/lib/me-context';
import { AttendanceCard } from '@/components/attendance-card';
import { DashboardOverview } from '@/components/dashboard-overview';

// Roles that clock in/out (Spec §3: Super Admin & Client never check in).
const CAN_CHECK_IN = ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function displayName(email: string): string {
  const base = email.split('@')[0] ?? email;
  return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

export default function DashboardPage() {
  const me = useMe();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Hero briefing — a luminous glass slab that opens the day (Aurora Glass). */}
      <section className="glass-hero animate-rise px-7 py-8 sm:px-9">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(124,108,246,0.40),transparent_68%)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-40 left-[42%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(236,72,153,0.22),transparent_68%)]"
        />
        <div className="relative">
          <p className="inline-flex items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_4px_rgba(79,70,229,0.16)]" />
            {new Date().toLocaleDateString(undefined, DATE_FMT)}
          </p>
          <h1 className="mt-3.5 text-3xl font-bold tracking-tight text-slate-900 sm:text-[2.3rem]">
            {greeting()}, {displayName(me.email)}
          </h1>
        </div>
      </section>

      {CAN_CHECK_IN.includes(me.role) ? <AttendanceCard /> : null}

      {/* Studio overview — self-gating: renders only for roles with reports access. */}
      <DashboardOverview />
    </div>
  );
}
