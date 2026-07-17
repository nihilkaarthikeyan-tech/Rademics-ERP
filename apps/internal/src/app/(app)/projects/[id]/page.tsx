'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { TaskDetailDrawer, type AssignableUser } from '@/components/projects/task-detail-drawer';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  clientFacing: boolean;
  deadline: string | null;
  overdue: boolean;
  assignee: { id: string; name: string } | null;
}
interface ProjectDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string | null;
  budgetAmount: string | null;
  pm: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  modules: { id: string; name: string }[];
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'SUBMITTED_FOR_REVIEW', label: 'In review' },
  { key: 'CLIENT_REVIEW', label: 'Client review' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'INVOICED', label: 'Invoiced' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];
const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'slate'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };
const CAN_CREATE_TASK = ['SUPER_ADMIN', 'PM', 'TEAM_LEAD'];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [members, setMembers] = useState<AssignableUser[]>([]);
  const [view, setView] = useState<'board' | 'list' | 'calendar'>('board');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('');

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

  const filtered = useMemo(
    () => (priorityFilter ? tasks.filter((t) => t.priority === priorityFilter) : tasks),
    [tasks, priorityFilter],
  );

  if (state === 'loading') return <LoadingState />;
  if (state === 'error' || !project) return <p className="text-sm text-slate-500">Could not load project.</p>;

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-800">{project.name}</h1>
            <Badge tone={project.type === 'STREAM' ? 'blue' : 'slate'}>
              {project.type === 'STREAM' ? 'Work stream' : 'Project'}
            </Badge>
            <Badge tone="green">{project.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {project.pm ? `PM: ${project.pm.name}` : 'No PM'}
            {project.client ? ` · Client: ${project.client.name}` : ''}
            {project.budgetAmount != null ? ` · Budget: ₹${Number(project.budgetAmount).toLocaleString()}` : ''}
          </p>
        </div>
        {CAN_CREATE_TASK.includes(me.role) ? <Button onClick={() => setCreating(true)}>New task</Button> : null}
      </div>

      {/* View toggle + filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-slate-200 p-0.5">
          {(['board', 'list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 text-sm capitalize ${view === v ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">All priorities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <span className="text-xs text-slate-400">{filtered.length} tasks</span>
      </div>

      <div className="mt-4">
        {view === 'board' ? (
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
          onClose={() => setCreating(false)}
          onCreated={loadTasks}
        />
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer
          taskId={openTaskId}
          members={members}
          onClose={() => setOpenTaskId(null)}
          onChanged={loadTasks}
        />
      ) : null}
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: TaskRow; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(task.id)}
      className="w-full rounded-md border border-white/70 bg-white/65 p-2.5 text-left shadow-glass backdrop-blur-xl hover:border-white/90"
    >
      <div className="text-sm font-medium text-slate-800">{task.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={PRIORITY_TONE[task.priority] ?? 'slate'}>{task.priority}</Badge>
        {task.clientFacing ? <Badge tone="blue">Client</Badge> : null}
        {task.overdue ? <Badge tone="red">Overdue</Badge> : null}
      </div>
      <div className="mt-1.5 text-xs text-slate-400">
        {task.assignee ? task.assignee.name : 'Unassigned'}
        {task.deadline ? ` · ${new Date(task.deadline).toLocaleDateString()}` : ''}
      </div>
    </button>
  );
}

function BoardView({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div key={col.key} className="w-64 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{col.label}</span>
              <span className="text-xs text-slate-400">{colTasks.length}</span>
            </div>
            <div className="flex min-h-16 flex-col gap-2 rounded-lg bg-slate-50 p-2">
              {colTasks.map((t) => (
                <TaskCard key={t.id} task={t} onOpen={onOpen} />
              ))}
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
  onClose,
  onCreated,
}: {
  projectId: string;
  modules: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [moduleId, setModuleId] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [deadline, setDeadline] = useState('');
  const [clientFacing, setClientFacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          title,
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
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <div>
              <Label htmlFor="t-title">Title</Label>
              <Input id="t-title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="t-priority">Priority</Label>
                <select id="t-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
              <div>
                <Label htmlFor="t-module">Module</Label>
                <select id="t-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="">None</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="t-est">Estimate (hours)</Label>
                <Input id="t-est" type="number" step="0.25" min="0.25" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="t-deadline">Deadline</Label>
                <Input id="t-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={clientFacing} onChange={(e) => setClientFacing(e.target.checked)} />
              Client-facing (requires a deadline)
            </label>
            {error ? <p className="text-xs text-slate-900">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
