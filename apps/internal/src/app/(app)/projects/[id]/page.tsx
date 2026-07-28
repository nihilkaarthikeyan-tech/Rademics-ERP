'use client';

import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, CardContent, EmptyState, Input, Label, LoadingState, PageGuide } from '@rademics/ui';
import { formatProjectCode } from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { TaskDetailDrawer, type AssignableUser } from '@/components/projects/task-detail-drawer';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  clientFacing: boolean;
  deadline: string | null;
  overdue: boolean;
  statusChangedAt: string;
  lastClientUpdateAt: string | null;
  createdAt: string;
  assignee: { id: string; name: string } | null;
}

/** Days a task has been sitting unaccepted — null under the 1-day grace. */
function unacceptedDays(t: TaskRow): number | null {
  if (t.status !== 'ASSIGNED') return null;
  const days = Math.floor((Date.now() - new Date(t.statusChangedAt).getTime()) / 86_400_000);
  return days >= 1 ? days : null;
}

/** Days since the client last saw any movement — null once finished; mirrors
 *  the server's runClientUpdateSweep. */
const CLIENT_SETTLED = ['COMPLETED', 'CLOSED', 'CANCELLED'];
function clientStaleDays(t: TaskRow): number | null {
  if (!t.clientFacing || CLIENT_SETTLED.includes(t.status)) return null;
  const since = new Date(t.lastClientUpdateAt ?? t.createdAt).getTime();
  const days = Math.floor((Date.now() - since) / 86_400_000);
  return days >= 3 ? days : null;
}
interface ProjectDetail {
  id: string;
  number: number;
  name: string;
  status: string;
  description: string | null;
  budgetAmount: string | null;
  pm: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  clientOrg: { id: string; code: string | null; name?: string } | null;
  modules: { id: string; name: string }[];
}

/**
 * Each pipeline stage carries its own colour so the board reads left-to-right
 * as a temperature map: cool neutrals while work is parked, the accent violets
 * while it moves, amber while it waits on review, green when it lands.
 */
const COLUMNS: { key: string; label: string; rail: string; dot: string }[] = [
  { key: 'DRAFT', label: 'Draft', rail: 'from-slate-300 to-slate-200', dot: 'bg-slate-400' },
  { key: 'ASSIGNED', label: 'Assigned', rail: 'from-[#7C6CF6] to-[#A78BFA]', dot: 'bg-[#7C6CF6]' },
  { key: 'ACKNOWLEDGED', label: 'Acknowledged', rail: 'from-sky-400 to-cyan-300', dot: 'bg-sky-500' },
  { key: 'IN_PROGRESS', label: 'In progress', rail: 'from-indigo-500 to-[#7C6CF6]', dot: 'bg-indigo-500' },
  { key: 'SUBMITTED_FOR_REVIEW', label: 'In review', rail: 'from-amber-400 to-orange-300', dot: 'bg-amber-500' },
  { key: 'COMPLETED', label: 'Completed', rail: 'from-emerald-400 to-teal-300', dot: 'bg-emerald-500' },
  { key: 'CLOSED', label: 'Closed', rail: 'from-slate-400 to-slate-300', dot: 'bg-slate-500' },
  { key: 'CANCELLED', label: 'Cancelled', rail: 'from-rose-400 to-pink-300', dot: 'bg-rose-500' },
];
const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'slate'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };
/** Priority as a quiet colour spine on the card's left edge, not a shouting badge. */
const PRIORITY_SPINE: Record<string, string> = {
  HIGH: 'bg-rose-400',
  MEDIUM: 'bg-amber-300',
  LOW: 'bg-slate-200',
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}
const DONE_STATUSES = ['COMPLETED', 'CLOSED', 'CANCELLED'];
/**
 * Columns always shown, because they are where work actively moves. The rest
 * (client review, completed, invoiced, closed, cancelled) only appear once they
 * hold something — otherwise every new project opens as ten empty columns that
 * scroll sideways off the screen and say nothing.
 */
const CORE_COLUMNS = ['DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW'];
// Roles that can run any project. The person APPOINTED to this project can too —
// that check needs the loaded project, so it lives in the component below.
const CAN_CREATE_TASK = ['SUPER_ADMIN', 'HR'];

/** useSearchParams needs a Suspense boundary at build time — thin wrapper only. */
export default function ProjectDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <ProjectDetail_ {...props} />
    </Suspense>
  );
}

function ProjectDetail_({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [members, setMembers] = useState<AssignableUser[]>([]);
  const [view, setView] = useState<'board' | 'list' | 'calendar'>('board');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [reserving, setReserving] = useState(false);

  const loadTasks = useCallback(async () => {
    const r = await apiFetch<{ items: TaskRow[] }>(`/tasks?projectId=${id}&pageSize=200`);
    setTasks(r.items);
  }, [id]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [proj] = await Promise.all([apiFetch<ProjectDetail>(`/projects/${id}`), loadTasks()]);
      setProject(proj);
      apiFetch<AssignableUser[]>('/projects/assignable-users').then(setMembers).catch(() => setMembers([]));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [id, loadTasks]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the task list needs to follow along — the project header rarely moves,
  // and refetching it on every task event would flicker the page for nothing.
  useAutoRefresh(loadTasks, { events: ['task:changed'] });

  // Deep link from a notification: /projects/<id>?task=<taskId> opens the panel.
  // Subscribed (not read-once): clicking a notification while ALREADY on this
  // project page only changes the query string — the component never remounts.
  const searchParams = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get('task');
    if (wanted) setOpenTaskId(wanted);
  }, [searchParams]);

  function closeTask() {
    setOpenTaskId(null);
    // Drop ?task= through the router (not history.replaceState) so
    // useSearchParams updates and the same notification can reopen it later.
    router.replace(`/projects/${id}`, { scroll: false });
  }

  /** Reserve a client ID for a project created without one. */
  async function makeClientProject() {
    setReserving(true);
    try {
      const updated = await apiFetch<ProjectDetail>(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ forClient: true }),
      });
      setProject(updated);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not reserve a client ID');
    } finally {
      setReserving(false);
    }
  }

  const filtered = useMemo(
    () => (priorityFilter ? tasks.filter((t) => t.priority === priorityFilter) : tasks),
    [tasks, priorityFilter],
  );

  const stats = useMemo(() => {
    const done = tasks.filter((t) => DONE_STATUSES.includes(t.status)).length;
    return {
      total: tasks.length,
      done,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      inFlight: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      unassigned: tasks.filter((t) => !t.assignee && !DONE_STATUSES.includes(t.status)).length,
      overdue: tasks.filter((t) => t.overdue).length,
    };
  }, [tasks]);

  if (state === 'loading') return <LoadingState />;
  if (state === 'error' || !project) return <p className="text-sm text-slate-500">Could not load project.</p>;

  // Authority over a project is per-project since the PM role was removed: either
  // the role runs every project, or you are the one appointed to this one.
  const runsThisProject = CAN_CREATE_TASK.includes(me.role) || project.pm?.id === me.id;

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Both codes needed to create the client's account live here, together,
                because this page is where anyone comes looking for them. */}
            <span className="font-mono text-sm text-slate-400">{formatProjectCode(project.number)}</span>
            {project.clientOrg?.code ? (
              <span className="font-mono text-sm font-medium text-accent">{project.clientOrg.code}</span>
            ) : null}
            <h1 className="text-xl font-semibold text-slate-800">{project.name}</h1>
            <Badge tone="green">{project.status}</Badge>
          </div>
          {project.description ? (
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{project.description}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            {project.pm ? (
              <span>
                Run by <span className="font-medium text-slate-700">{project.pm.name}</span>
              </span>
            ) : (
              // An unassigned project is a gap someone should close, not a neutral
              // fact — so it reads as a prompt rather than grey filler.
              <span className="rounded-full border border-amber-200/70 bg-amber-50/70 px-2.5 py-0.5 text-xs font-medium text-amber-800 backdrop-blur">
                No project manager{CAN_CREATE_TASK.includes(me.role) ? ' — you and HR are running it' : ''}
              </span>
            )}
            {project.client ? <span>Client: {project.client.name}</span> : null}
            {project.budgetAmount != null ? (
              <span>Budget: ₹{Number(project.budgetAmount).toLocaleString()}</span>
            ) : null}
          </div>

          {/* Client-facing tasks with no client ID: the work is marked for a client
              who has no way to log in and see it. Reachable because the two
              checkboxes are separate — one marks a task, the other makes the
              project client work — and ticking only the first is an easy mistake. */}
          {!project.clientOrg && tasks.some((t) => t.clientFacing) && CAN_CREATE_TASK.includes(me.role) ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3.5 py-2.5 text-sm text-amber-900 shadow-glass backdrop-blur-xl">
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1">
                Tasks here are marked for a client, but this isn&apos;t a client project — so no
                client can see them.
              </span>
              <button
                onClick={() => void makeClientProject()}
                disabled={reserving}
                className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_-8px_rgba(245,158,11,0.7)] transition-colors hover:bg-amber-600 disabled:opacity-60"
              >
                {reserving ? 'Reserving…' : 'Make it a client project'}
              </button>
            </div>
          ) : null}
        </div>
        {runsThisProject ? <Button onClick={() => setCreating(true)}>New task</Button> : null}
      </div>

      {/* Progress at a glance — the question anyone opening a project asks first. */}
      {stats.total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/70 bg-white/60 px-4 py-3 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="h-2 w-36 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7C6CF6] to-emerald-400 transition-all duration-500"
                style={{ width: `${Math.max(stats.pct, stats.pct > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-slate-800">{stats.pct}% done</span>
          </div>
          <span className="text-sm text-slate-500">
            {stats.done} of {stats.total} finished
          </span>
          {stats.inFlight > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              {stats.inFlight} in progress
            </span>
          ) : null}
          {stats.unassigned > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              {stats.unassigned} unassigned
            </span>
          ) : null}
          {stats.overdue > 0 ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-sm font-medium text-rose-600">
              {stats.overdue} overdue
            </span>
          ) : null}
        </div>
      ) : null}

      {runsThisProject && tasks.length > 0 ? (
        <PageGuide
          id="project-board"
          title="How the board works"
          className="mt-4"
          notes={[
            'Work moves left to right: Draft → Assigned → Acknowledged → In progress → In review → Completed. Cards are not dragged — the person responsible presses the button for their step, so every move is recorded with who did it and when.',
            'Assigning a task notifies that person immediately and puts it in their My Work. If nobody accepts it within a day the system reminds them, and after two days it tells you.',
            'Tick “The client will see this” on a task to show it in the client’s portal. Everything else stays internal.',
          ]}
        />
      ) : null}

      {/* View toggle + filters — pointless before any work exists */}
      <div className={`mt-4 flex flex-wrap items-center gap-2 ${tasks.length === 0 ? 'hidden' : ''}`}>
        <div className="inline-flex rounded-full border border-white/70 bg-white/60 p-1 shadow-glass backdrop-blur-xl">
          {(['board', 'list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3.5 py-1 text-sm capitalize transition-colors ${
                view === v
                  ? 'bg-gradient-to-r from-[#4F46E5] to-[#7C6CF6] font-medium text-white shadow-[0_8px_18px_-8px_rgba(79,70,229,0.6)]'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="h-8 rounded-full border border-white/70 bg-white/60 px-3 text-sm text-slate-700 shadow-glass backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">All priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <span className="text-xs text-slate-400">
          {filtered.length} task{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-4">
        {tasks.length === 0 ? (
          // A brand-new project: say what to do next instead of showing a row of
          // empty columns. This is the first screen anyone sees after creating one.
          <EmptyState
            title="No tasks yet"
            description={
              runsThisProject
                ? 'Add the first piece of work and assign it to someone — they are notified straight away and it appears in their My Work.'
                : 'Work added to this project will appear here.'
            }
            action={runsThisProject ? <Button onClick={() => setCreating(true)}>Create the first task</Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter"
            description="No tasks with this priority. Clear the filter to see the rest."
            action={
              <Button variant="outline" onClick={() => setPriorityFilter('')}>
                Show all priorities
              </Button>
            }
          />
        ) : view === 'board' ? (
          <BoardView tasks={filtered} onOpen={setOpenTaskId} />
        ) : view === 'list' ? (
          <ListView tasks={filtered} onOpen={setOpenTaskId} />
        ) : (
          <CalendarView tasks={filtered} onOpen={setOpenTaskId} />
        )}
      </div>

      {creating ? (
        <NewTaskModal
          projectId={id}
          modules={project.modules}
          members={members}
          onClose={() => setCreating(false)}
          onCreated={loadTasks}
        />
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer
          taskId={openTaskId}
          members={members}
          pm={project.pm}
          onClose={closeTask}
          onChanged={loadTasks}
        />
      ) : null}
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: TaskRow; onOpen: (id: string) => void }) {
  const waiting = unacceptedDays(task);
  const clientStale = clientStaleDays(task);
  return (
    <button
      onClick={() => onOpen(task.id)}
      className="group relative w-full overflow-hidden rounded-xl border border-white/80 bg-white/80 p-3 pl-4 text-left shadow-glass backdrop-blur-xl transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_14px_30px_-14px_rgba(124,108,246,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* Priority spine — colour says HIGH/MEDIUM/LOW without a badge shouting it. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${PRIORITY_SPINE[task.priority] ?? 'bg-slate-200'}`}
      />
      <div className="text-sm font-semibold leading-snug text-slate-800 group-hover:text-slate-900">
        {task.title}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.clientFacing ? <Badge tone="blue">Client</Badge> : null}
        {task.overdue ? <Badge tone="red">Overdue</Badge> : null}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        {task.assignee ? (
          <>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">
              {initialsOf(task.assignee.name)}
            </span>
            <span className="truncate">{task.assignee.name}</span>
          </>
        ) : (
          <span className="italic text-slate-400">Unassigned</span>
        )}
        {task.deadline ? (
          <span className={`ml-auto shrink-0 ${task.overdue ? 'font-medium text-rose-500' : 'text-slate-400'}`}>
            {new Date(task.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        ) : null}
      </div>
      {/* A handoff nobody picked up is the silent stall this board exists to
          prevent — say it on the card, not only inside the panel. */}
      {waiting !== null ? (
        <div className="mt-2 rounded-md bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning">
          Not accepted yet · {waiting} day{waiting === 1 ? '' : 's'}
        </div>
      ) : null}
      {/* The client can't see movement on this one — same silent-stall idea,
          just measured by what the client has been shown, not internal status. */}
      {clientStale !== null ? (
        <div className="mt-2 rounded-md bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning">
          Client waiting for update · {clientStale} day{clientStale === 1 ? '' : 's'}
        </div>
      ) : null}
    </button>
  );
}

function BoardView({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (id: string) => void }) {
  // Show the working columns plus any later stage that actually holds a task.
  const columns = COLUMNS.filter(
    (c) => CORE_COLUMNS.includes(c.key) || tasks.some((t) => t.status === c.key),
  );
  return (
    <div className="scrollbar-slim flex gap-3 overflow-x-auto pb-3">
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div
            key={col.key}
            className="flex w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/40 shadow-glass backdrop-blur-xl"
          >
            {/* Stage-coloured rail: the board reads by colour before any label. */}
            <div className={`h-1 w-full bg-gradient-to-r ${col.rail}`} />
            <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} />
                {col.label}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  colTasks.length > 0 ? 'bg-white/80 text-slate-600' : 'text-slate-300'
                }`}
              >
                {colTasks.length}
              </span>
            </div>
            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {colTasks.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200/80 py-4 text-[11px] text-slate-300">
                  Nothing here
                </div>
              ) : (
                colTasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Task</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Priority</th>
              <th className="px-4 py-2.5 font-medium">Assignee</th>
              <th className="px-4 py-2.5 font-medium">Deadline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(t.id)}>
                <td className="px-4 py-2.5 font-medium text-slate-800">
                  {t.title}
                  {t.overdue ? <Badge tone="red" className="ml-2">Overdue</Badge> : null}
                </td>
                <td className="px-4 py-2.5"><Badge tone="slate">{t.status.replace(/_/g, ' ')}</Badge></td>
                <td className="px-4 py-2.5"><Badge tone={PRIORITY_TONE[t.priority] ?? 'slate'}>{t.priority}</Badge></td>
                <td className="px-4 py-2.5 text-slate-600">{t.assignee?.name ?? '—'}</td>
                <td className="px-4 py-2.5 text-slate-600">{t.deadline ? new Date(t.deadline).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CalendarView({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (id: string) => void }) {
  const withDeadline = tasks.filter((t) => t.deadline);
  const groups = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of withDeadline) {
      const key = new Date(t.deadline!).toLocaleDateString();
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  }, [withDeadline]);

  if (groups.length === 0) return <p className="text-sm text-slate-500">No tasks with deadlines.</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map(([date, items]) => (
        <Card key={date}>
          <CardContent className="pt-4">
            <div className="mb-2 text-sm font-semibold text-slate-700">{date}</div>
            <div className="flex flex-wrap gap-2">
              {items.map((t) => (
                <div key={t.id} className="w-56">
                  <TaskCard task={t} onOpen={onOpen} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NewTaskModal({
  projectId,
  modules,
  members,
  onClose,
  onCreated,
}: {
  projectId: string;
  modules: { id: string; name: string }[];
  members: AssignableUser[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [moduleId, setModuleId] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [deadline, setDeadline] = useState('');
  const [clientFacing, setClientFacing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Caught here rather than at the API so the person is told before losing the
    // form — the server enforces the same rule regardless (§24).
    if (clientFacing && !deadline) {
      setError('A client-facing task needs a deadline — the client sees it.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // One request creates AND assigns: the API accepts assigneeId on create, so
      // there is no second trip through the assign screen.
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          title,
          description: description || undefined,
          assigneeId: assigneeId || undefined,
          priority,
          moduleId: moduleId || undefined,
          estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          clientFacing,
        }),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold text-slate-800">New task</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pick someone now and the task goes straight to them. Leave it unassigned to keep it as a draft.
          </p>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <div>
              <Label htmlFor="t-title">What needs doing?</Label>
              <Input
                id="t-title"
                required
                minLength={3}
                placeholder="e.g. Draft the paper publication annexure"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="t-desc">Details <span className="font-normal text-slate-400">(optional)</span></Label>
              <textarea
                id="t-desc"
                rows={3}
                placeholder="Anything the person needs to know before starting."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <div>
              <Label htmlFor="t-assignee">Assign to</Label>
              <select
                id="t-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="">Nobody yet — save as draft</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {typeof m.openTasks === 'number'
                      ? ` — ${m.openTasks === 0 ? 'free' : `${m.openTasks} open task${m.openTasks === 1 ? '' : 's'}`}`
                      : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {assigneeId
                  ? 'They will be notified straight away and it lands in their My Work list.'
                  : 'You can assign it later from the task itself.'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="t-priority">Priority</Label>
                <select id="t-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
              <div>
                <Label htmlFor="t-deadline">Deadline</Label>
                <Input id="t-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>

            {/*
              Module and Estimate are secondary: a project usually has no modules
              at all (the dropdown would offer only "None"), and few tasks get an
              hour estimate at the moment they are written down. Neither can be
              edited later — the task drawer shows them read-only — so they stay
              reachable here rather than being dropped, just out of the main path.
            */}
            {modules.length > 0 || showMore ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {modules.length > 0 ? (
                  <div>
                    <Label htmlFor="t-module">Module</Label>
                    <select id="t-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                      <option value="">None</option>
                      {modules.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {showMore ? (
                  <div>
                    <Label htmlFor="t-est">
                      Estimate <span className="font-normal text-slate-400">(hours)</span>
                    </Label>
                    <Input id="t-est" type="number" step="0.25" min="0.25" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {!showMore ? (
              <button
                type="button"
                onClick={() => setShowMore(true)}
                className="self-start text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
              >
                Add a time estimate
              </button>
            ) : null}
            <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={clientFacing}
                onChange={(e) => setClientFacing(e.target.checked)}
              />
              <span>
                The client will see this
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  Shows up in their progress feed once assigned. Needs a deadline.
                </span>
              </span>
            </label>
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : assigneeId ? 'Create & assign' : 'Create draft'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
