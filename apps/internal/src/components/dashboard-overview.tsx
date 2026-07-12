'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Studio overview (Spec §17.1). Every figure is derived from the real reports
 * endpoints — capacity (§5.9) and project-status (§21) — so nothing here is
 * fabricated. Only rendered for roles holding reports.dashboard.view; other roles
 * get a 403 and we simply don't show it (the personal widgets carry their view).
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
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (state === 'error' || !cap || !projects) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Couldn’t load the overview right now.
      </p>
    );
  }

  // ── Derived, honest KPIs ──
  const teams = new Set(cap.map((c) => c.team).filter(Boolean)).size;
  const atRisk = projects.filter((p) => p.risk !== 'LOW').length;
  const avgComplete = projects.length
    ? round(projects.reduce((n, p) => n + p.pctComplete, 0) / projects.length)
    : 0;
  const overdue = projects.reduce((n, p) => n + p.overdue, 0);

  const avail = {
    GREEN: cap.filter((c) => c.availability === 'GREEN').length,
    AMBER: cap.filter((c) => c.availability === 'AMBER').length,
    RED: cap.filter((c) => c.availability === 'RED').length,
  };

  const topProjects = [...projects]
    .sort((a, b) => b.pctComplete - a.pctComplete)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPI strip ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} tint="blue" label="Active people" value={String(cap.length)} sub={teams ? `across ${teams} team${teams === 1 ? '' : 's'}` : 'internal team'} />
        <Kpi icon={FolderKanban} tint="teal" label="Live projects" value={String(projects.length)} sub={atRisk ? `${atRisk} need attention` : 'all on track'} />
        <Kpi icon={TrendingUp} tint="gold" label="Avg completion" value={`${avgComplete}%`} sub="across all projects" />
        <Kpi icon={AlertTriangle} tint="red" label="Overdue tasks" value={String(overdue)} sub={overdue ? 'needs review' : 'nothing overdue'} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Project completion */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Project completion</h3>
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
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-900"
                      style={{ width: `${Math.max(2, Math.min(100, p.pctComplete))}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-700">
                    {round(p.pctComplete)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team availability donut */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">Team availability</h3>
          <AvailabilityDonut avail={avail} total={cap.length} />
        </div>
      </div>

      {/* ── Projects table ── */}
      {topProjects.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-800">Projects</h3>
            <span className="text-xs text-slate-400">{projects.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  <th className="px-5 py-2.5 font-medium">PM</th>
                  <th className="px-5 py-2.5 font-medium">Complete</th>
                  <th className="px-5 py-2.5 text-right font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {topProjects.map((p) => (
                  <tr key={p.project} className="border-t border-slate-100">
                    <td className="px-5 py-3 font-medium text-slate-800">{p.project}</td>
                    <td className="px-5 py-3 text-slate-500">{p.client}</td>
                    <td className="px-5 py-3 text-slate-500">{p.pm}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{round(p.pctComplete)}%</td>
                    <td className="px-5 py-3 text-right">
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

// Monochrome (user direction): KPI icons are neutral; meaning comes from the icon
// glyph + label, not color.
const TINTS = {
  blue: { icon: 'bg-slate-100 text-slate-700' },
  teal: { icon: 'bg-slate-100 text-slate-700' },
  gold: { icon: 'bg-slate-100 text-slate-700' },
  red: { icon: 'bg-slate-900 text-white' },
} as const;

function Kpi({
  icon: Icon,
  tint,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  sub: string;
}) {
  const t = TINTS[tint];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: ProjectRow['risk'] }) {
  // Monochrome severity by weight: outlined → mid-grey → solid black.
  const map = {
    LOW: 'border border-slate-300 bg-white text-slate-600',
    MEDIUM: 'bg-slate-200 text-slate-800',
    HIGH: 'bg-slate-900 text-white',
  } as const;
  const label = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }[risk];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${map[risk]}`}>{label}</span>
  );
}

function AvailabilityDonut({
  avail,
  total,
}: {
  avail: { GREEN: number; AMBER: number; RED: number };
  total: number;
}) {
  // Monochrome: darkness encodes load (light = free, black = at capacity); the
  // legend labels carry the exact meaning.
  const segs = [
    { key: 'GREEN', label: 'Available', color: '#D4D4D4', n: avail.GREEN },
    { key: 'AMBER', label: 'Nearing full', color: '#737373', n: avail.AMBER },
    { key: 'RED', label: 'At capacity', color: '#171717', n: avail.RED },
  ];
  const C = 100; // circumference units
  let offset = 25; // start at 12 o'clock
  const arcs = segs.map((s) => {
    const len = total > 0 ? (s.n / total) * C : 0;
    const arc = { ...s, dash: len, off: offset };
    offset -= len;
    return arc;
  });

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 42 42" className="h-32 w-32">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#F5F5F5" strokeWidth="5" />
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
                    strokeWidth="5"
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
      <div className="flex flex-col gap-2 text-sm">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="ml-auto font-semibold tabular-nums text-slate-800">{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
