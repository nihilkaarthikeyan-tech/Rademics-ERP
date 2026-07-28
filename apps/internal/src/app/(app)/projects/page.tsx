'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardContent, EmptyState, ErrorState, Input, Label, LoadingState, PageGuide } from '@rademics/ui';
import { formatProjectCode } from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

interface ProjectRow {
  id: string;
  number: number;
  name: string;
  status: string;
  pm: { id: string; name: string } | null;
  // Super Admin alone gets `client`; everyone else gets only the code.
  client: { id: string; name: string } | null;
  clientOrg: { id: string; code: string | null; name?: string } | null;
  _count: { tasks: number; modules: number };
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red'> = {
  ACTIVE: 'green',
  ON_HOLD: 'amber',
  ARCHIVED: 'slate',
  CLOSED: 'slate',
};

const CAN_CREATE = ['SUPER_ADMIN', 'HR'];

export default function ProjectsPage() {
  const me = useMe();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setProjects(await apiFetch<ProjectRow[]>('/projects'));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load, { events: ['task:changed'] });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Projects</h1>
          <p className="mt-1 text-sm text-slate-500">Client work and internal projects</p>
        </div>
        {CAN_CREATE.includes(me.role) ? (
          <Button onClick={() => setCreating(true)}>New project</Button>
        ) : null}
      </div>

      {creating ? <NewProjectModal onClose={() => setCreating(false)} onCreated={load} /> : null}

      {CAN_CREATE.includes(me.role) ? (
        <PageGuide
          id="projects"
          title="Before you create a project"
          className="mt-4"
          notes={[
            'Tick “This is for a client” if the client should ever see progress. It reserves a client ID you will need to create their portal login — and it cannot be added as an afterthought without extra steps.',
            'Appointing a manager is optional. Whoever you appoint can create, assign and review tasks for that project only. Leave it empty and you and HR run it.',
          ]}
        />
      ) : null}

      <div className="mt-4">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'error' ? (
          <ErrorState description="Could not load projects." onRetry={load} />
        ) : !projects || projects.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                title="No projects yet"
                description={CAN_CREATE.includes(me.role) ? 'Create your first project to get started.' : 'Projects you can access will appear here.'}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="h-full transition-colors hover:border-slate-300">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-800">{p.name}</h3>
                      <Badge tone={STATUS_TONE[p.status] ?? 'slate'}>{p.status}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono">{formatProjectCode(p.number)}</span>
                      <span>·</span>
                      {p.pm ? <span>Manager: {p.pm.name}</span> : <span>No manager yet</span>}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      {p._count.tasks} {p._count.tasks === 1 ? 'task' : 'tasks'} · {p._count.modules} modules
                      {p.clientOrg?.code
                        ? ` · client: ${p.clientOrg.name ?? p.clientOrg.code}`
                        : ''}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ManagerOption {
  id: string;
  name: string;
  role: string;
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pmId, setPmId] = useState('');
  const [forClient, setForClient] = useState(false);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the project exists. Marking it as client work reserves a client
  // ID, and that code is needed later to create the client's account — so the
  // modal stays open to show it rather than closing over the one piece of
  // information the next step depends on.
  const [created, setCreated] = useState<{ code: string; clientCode: string | null } | null>(null);

  // Anyone on staff can be appointed — the appointment IS the authority, so this
  // list is deliberately wide rather than filtered to a job title.
  useEffect(() => {
    apiFetch<ManagerOption[]>('/projects/appointable-managers')
      .then(setManagers)
      .catch(() => setManagers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await apiFetch<{ number: number; clientOrg: { code: string | null } | null }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || undefined,
          pmId: pmId || undefined,
          forClient: forClient || undefined,
        }),
      });
      onCreated();
      setCreated({
        code: formatProjectCode(project.number),
        clientCode: project.clientOrg?.code ?? null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardContent className="pt-6">
          {created ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Project created</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {created.clientCode
                    ? 'Write these down — you need both to create the client’s account.'
                    : 'An internal project. No client will see it.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Project number</span>
                  <span className="font-mono text-base font-semibold text-slate-800">{created.code}</span>
                </div>
                {created.clientCode ? (
                  <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Client ID</span>
                    <span className="font-mono text-base font-semibold text-accent">{created.clientCode}</span>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                {created.clientCode ? (
                  <Link href="/clients/new">
                    <Button type="button">Create the client account</Button>
                  </Link>
                ) : null}
                <Button type="button" variant="outline" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
          <>
          <h2 className="text-lg font-semibold text-slate-800">New project</h2>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                required
                minLength={3}
                placeholder="Enter the project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p-desc">Description</Label>
              <textarea
                id="p-desc"
                rows={3}
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <div>
              <Label htmlFor="p-pm">
                Project manager <span className="font-normal text-slate-400">(optional)</span>
              </Label>
              <select
                id="p-pm"
                value={pmId}
                onChange={(e) => setPmId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Nobody — you and HR will run it</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Whoever you pick can create and assign tasks, review work and close this project —
                and nothing outside it. You can change this later.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <input
                type="checkbox"
                checked={forClient}
                onChange={(e) => setForClient(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800">This is for a client</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  A client ID is reserved and shown next. You&apos;ll need it, with the project
                  number, to create their account.
                </span>
              </span>
            </label>
            {error ? <p className="text-xs text-slate-900">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
