'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Studio overview (Spec §17.1). Every figure is derived from the real reports
 * endpoints — capacity (§5.9) and project-status (§21) — so nothing here is
 * fabricated. Only rendered for roles holding reports.dashboard.view; other roles
 * get a 403 and we simply don't show it (the personal widgets carry their view).
 *
 * Aurora Glass treatment (2026-07-18, user-approved): frosted surfaces on the
 * aurora ground, gradient icon tiles, soft-coloured status. Contextual chips/meters
 * only ever show numbers we can derive from the real data above.
 */

interface CapacityRow {
  userId: string;
  name: string;
  team: string | null;
  openTasks: number;
  utilizationPct: number;
  availability: 'GREEN' | 'AMBER' | 'RED';
}

interface ProjectRow {
  project: string;
  client: string;
  pm: string;
  type: string;
  overdue: number;
  pctComplete: number;
  throughputPerWeek: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface ReportData {
  title: string;
  columns: { key: string; label: string }[];
  rows: ProjectRow[];
}

const round = (n: number) => Math.round(n);
const s = (n: number) => (n === 1 ? '' : 's');

function initials(name: string): string {
  const parts = name.replace(/[._-]+/g, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

export function DashboardOverview() {
  const [cap, setCap] = useState<CapacityRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');

  useEffect(() => {
    Promise.all([
      apiFetch<CapacityRow[]>('/reports/capacity'),
      apiFetch<ReportData>('/reports/project-status'),
    ])
      .then(([c, p]) => {
        setCap(c);
        setProjects(p.rows);
        setState('ready');
      })
      .catch((err) => {
        setState(err instanceof ApiError && err.status === 403 ? 'denied' : 'error');
      });
  }, []);

  // Roles without reports access keep their personal dashboard — show nothing here.
  if (state === 'denied') return null;

  if (state === 'loading') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-panel h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  if (state === 'error' || !cap || !projects) {
    return (
      <p className="glass-panel p-4 text-sm text-slate-500">Couldn’t load the overview right now.</p>
    );
  }

  // ── Derived, honest KPIs ──
  const teams = new Set(cap.map((c) => c.team).filter(Boolean)).size;
  const atRisk = projects.filter((p) => p.risk !== 'LOW').length;
  const avgComplete = projects.length
    ? round(projects.reduce((n, p) => n + p.pctComplete, 0) / projects.length)
    : 0;
  const overdue = projects.reduce((n, p) => n + p.overdue, 0);
  const atRiskPct = projects.length ? round((atRisk / projects.length) * 100) : 0;

  const avail = {
    GREEN: cap.filter((c) => c.availability === 'GREEN').length,
    AMBER: cap.filter((c) => c.availability === 'AMBER').length,
    RED: cap.filter((c) => c.availability === 'RED').length,
  };

  const topProjects = [...projects]
    .sort((a, b) => b.pctComplete - a.pctComplete)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Studio read — a plain-language summary, every number real ── */}
      <p className="max-w-2xl text-[15px] leading-relaxed text-slate-600">
        {atRisk > 0 || overdue > 0 ? (
          <>
            {atRisk > 0 && (
              <>
                <b className="font-semibold text-slate-900">
                  {atRisk} project{s(atRisk)}
                </b>{' '}
                need a closer look
              </>
            )}
            {atRisk > 0 && overdue > 0 && ' and '}
            {overdue > 0 && (
              <>
                <b className="font-semibold text-danger">
                  {overdue} task{s(overdue)}
                </b>{' '}
                slipped past due
              </>
            )}
            {teams > 0 && (
              <>
                {' '}— across{' '}
                <b className="font-semibold text-slate-900">
                  {teams} team{s(teams)}
                </b>
              </>
            )}
            .
          </>
        ) : (
          <>
            Everything’s on track
            {teams > 0 && (
              <>
                {' '}across{' '}
                <b className="font-semibold text-slate-900">
                  {teams} team{s(teams)}
                </b>
              </>
            )}
            .
          </>
        )}
      </p>

      {/* ── KPI strip ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Users}
          tint="indigo"
          delay={40}
          label="Active people"
          value={String(cap.length)}
          sub={teams ? `across ${teams} team${s(teams)}` : 'internal team'}
        />
        <Kpi
          icon={FolderKanban}
          tint="teal"
          delay={100}
          label="Live projects"
          value={String(projects.length)}
          sub={atRisk ? `${atRisk} need attention` : 'all on track'}
          chip={atRisk ? { label: `${atRiskPct}% at risk`, tone: 'warn' } : undefined}
        />
        <Kpi
          icon={TrendingUp}
          tint="amber"
          delay={160}
          label="Avg completion"
          value={`${avgComplete}%`}
          sub="across all projects"
          meterPct={avgComplete}
        />
        <Kpi
          icon={AlertTriangle}
          tint="rose"
          delay={220}
          label="Overdue tasks"
          value={String(overdue)}
          sub={overdue ? 'needs review' : 'nothing overdue'}
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Project completion */}
        <div
          className="glass-panel animate-rise p-6 transition-all duration-200 hover:shadow-glass-hover lg:col-span-2"
          style={{ animationDelay: '280ms' }}
        >
          <div className="mb-5 flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Delivery
              </div>
              <h3 className="mt-1 text-[15px] font-bold tracking-tight text-slate-900">
                Project completion
              </h3>
            </div>
            <span className="text-xs text-slate-400">% of tasks done</span>
          </div>
          {topProjects.length === 0 ? (
            <p className="py-6 text-sm text-slate-400">No projects yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {topProjects.map((p) => (
                <div key={p.project} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 truncate text-sm text-slate-600" title={p.project}>
                    {p.project}
                  </div>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[rgba(79,70,229,0.10)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#4F46E5] to-[#A855F7]"
                      style={{ width: `${Math.max(2, Math.min(100, p.pctComplete))}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-slate-900">
                    {round(p.pctComplete)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team availability donut */}
        <div
          className="glass-panel animate-rise p-6 transition-all duration-200 hover:shadow-glass-hover"
          style={{ animationDelay: '340ms' }}
        >
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            Capacity
          </div>
          <h3 className="mb-4 mt-1 text-[15px] font-bold tracking-tight text-slate-900">
            Team availability
          </h3>
          <AvailabilityDonut avail={avail} total={cap.length} />
        </div>
      </div>

      {/* ── Projects table ── */}
      {topProjects.length > 0 ? (
        <div
          className="glass-panel animate-rise overflow-hidden p-0 transition-all duration-200 hover:shadow-glass-hover"
          style={{ animationDelay: '400ms' }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Portfolio
              </div>
              <h3 className="mt-1 text-[15px] font-bold tracking-tight text-slate-900">Projects</h3>
            </div>
            <span className="text-xs text-slate-400">{projects.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-white/50 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <th className="px-6 py-2.5 font-semibold">Project</th>
                  <th className="px-6 py-2.5 font-semibold">Client</th>
                  <th className="px-6 py-2.5 font-semibold">PM</th>
                  <th className="px-6 py-2.5 font-semibold">Completion</th>
                  <th className="px-6 py-2.5 text-right font-semibold">Risk</th>
                </tr>
              </thead>
              <tbody>
                {topProjects.map((p) => (
                  <tr key={p.project} className="border-t border-white/50 transition-colors hover:bg-white/40">
                    <td className="px-6 py-3.5 font-semibold text-slate-900">{p.project}</td>
                    <td className="px-6 py-3.5 text-slate-500">{p.client}</td>
                    <td className="px-6 py-3.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-[10px] font-bold text-white">
                          {initials(p.pm)}
                        </span>
                        <span className="text-slate-500">{p.pm}</span>
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(79,70,229,0.10)] sm:inline-block">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-[#4F46E5] to-[#A855F7]"
                            style={{ width: `${Math.max(2, Math.min(100, p.pctComplete))}%` }}
                          />
                        </span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {round(p.pctComplete)}%
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <RiskBadge risk={p.risk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Pieces ── */

// Gradient icon tiles (Aurora Glass): a small vivid glyph per KPI; status still reads
// by label too. Chips/meters only ever carry numbers derived from the real data.
const TINTS = {
  indigo: 'bg-gradient-to-br from-[#6D63F0] to-[#9B4FF0]',
  teal: 'bg-gradient-to-br from-[#22C3B4] to-[#12A08F]',
  amber: 'bg-gradient-to-br from-[#F5B84C] to-[#E08A2B]',
  rose: 'bg-gradient-to-br from-[#F2739B] to-[#D8356E]',
} as const;

const METER = {
  indigo: 'bg-gradient-to-r from-[#4F46E5] to-[#A855F7]',
  teal: 'bg-gradient-to-r from-[#22C3B4] to-[#12A08F]',
  amber: 'bg-gradient-to-r from-[#E0A23A] to-[#F0C163]',
  rose: 'bg-gradient-to-r from-[#F2739B] to-[#D8356E]',
} as const;

function Kpi({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  delay = 0,
  meterPct,
  chip,
}: {
  icon: typeof Users;
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  sub: string;
  delay?: number;
  meterPct?: number;
  chip?: { label: string; tone: 'up' | 'warn' };
}) {
  return (
    <div
      className="glass-panel animate-rise p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glass-hover"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] ${TINTS[tint]}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="mt-4 text-[34px] font-bold leading-none tracking-tight tabular-nums text-slate-900">
        {value}
      </div>
      {typeof meterPct === 'number' ? (
        <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[rgba(79,70,229,0.10)]">
          <div
            className={`h-full rounded-full ${METER[tint]}`}
            style={{ width: `${Math.max(2, Math.min(100, meterPct))}%` }}
          />
        </div>
      ) : null}
      <div className="mt-2 text-xs text-slate-400">{sub}</div>
      {chip ? (
        <span
          className={`mt-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            chip.tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'
          }`}
        >
          {chip.label}
        </span>
      ) : null}
    </div>
  );
}

function RiskBadge({ risk }: { risk: ProjectRow['risk'] }) {
  // Soft-coloured severity: pale green → amber → rose, each with a status dot.
  const map = {
    LOW: 'bg-success-soft text-success',
    MEDIUM: 'bg-warning-soft text-warning',
    HIGH: 'bg-danger-soft text-danger',
  } as const;
  const dot = { LOW: 'bg-success', MEDIUM: 'bg-warning', HIGH: 'bg-danger' } as const;
  const label = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }[risk];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${map[risk]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot[risk]}`} />
      {label}
    </span>
  );
}

function AvailabilityDonut({
  avail,
  total,
}: {
  avail: { GREEN: number; AMBER: number; RED: number };
  total: number;
}) {
  // Soft-coloured load: teal free → amber busy → rose full; the legend labels still
  // carry the exact meaning.
  const segs = [
    { key: 'GREEN', label: 'Available', color: '#2DC7B4', n: avail.GREEN },
    { key: 'AMBER', label: 'Nearing full', color: '#F0B23C', n: avail.AMBER },
    { key: 'RED', label: 'At capacity', color: '#EC5F86', n: avail.RED },
  ];
  const C = 100; // circumference units
  let offset = 25; // start at 12 o'clock
  const arcs = segs.map((seg) => {
    const len = total > 0 ? (seg.n / total) * C : 0;
    const arc = { ...seg, dash: len, off: offset };
    offset -= len;
    return arc;
  });

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 42 42" className="h-32 w-32">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgba(79,70,229,0.12)" strokeWidth="4.4" />
          {total > 0
            ? arcs
                .filter((a) => a.dash > 0)
                .map((a) => (
                  <circle
                    key={a.key}
                    cx="21"
                    cy="21"
                    r="15.9"
                    fill="none"
                    stroke={a.color}
                    strokeWidth="4.4"
                    strokeDasharray={`${a.dash} ${C - a.dash}`}
                    strokeDashoffset={a.off}
                    strokeLinecap="round"
                    transform="rotate(-90 21 21)"
                  />
                ))
            : null}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">{total}</div>
            <div className="text-[10px] text-slate-400">people</div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 text-sm">
        {segs.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2.5 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seg.color }} />
            {seg.label}
            <span className="ml-auto font-bold tabular-nums text-slate-900">{seg.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
