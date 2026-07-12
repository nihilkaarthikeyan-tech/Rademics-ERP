'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Badge, Button, Input } from '@rademics/ui';
import { TASK_TRANSITIONS, TaskAction, type TaskStatus } from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';
import { TaskFiles } from './task-files';

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  resourceType: string;
}

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  clientFacing: boolean;
  deadline: string | null;
  estimatedHours: string | null;
  overdue: boolean;
  assignee: { id: string; name: string } | null;
  module: { id: string; name: string } | null;
  subtasks: { id: string; title: string; status: string }[];
  checklist: { id: string; text: string; done: boolean }[];
  history: { id: string; fromStatus: string | null; toStatus: string; action: string; actorEmail: string | null; comment: string | null; createdAt: string }[];
  comments: { id: string; body: string; visibility: string; author: { name: string } | null; createdAt: string }[];
}

const ACTION_LABEL: Record<string, string> = {
  ACKNOWLEDGE: 'Acknowledge',
  START_WORK: 'Start work',
  SUBMIT: 'Submit for review',
  APPROVE_REVIEW: 'Approve',
  SEND_BACK: 'Send back',
  CLIENT_APPROVE: 'Client approve',
  CLIENT_REQUEST_REVISION: 'Request revision',
  MARK_INVOICED: 'Mark invoiced',
  CLOSE: 'Close',
  CLOSE_WITHOUT_INVOICING: 'Close (no invoice)',
  CANCEL: 'Cancel',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red' | 'blue'> = {
  DRAFT: 'slate', ASSIGNED: 'blue', ACKNOWLEDGED: 'blue', IN_PROGRESS: 'amber',
  SUBMITTED_FOR_REVIEW: 'amber', CLIENT_REVIEW: 'amber', COMPLETED: 'green',
  INVOICED: 'green', CLOSED: 'slate', CANCELLED: 'red',
};

/** Actions legal from a status (excludes assign/reassign — handled by the picker). */
function availableActions(status: TaskStatus): { action: TaskAction; requiresComment: boolean }[] {
  const list = TASK_TRANSITIONS.filter(
    (t) => t.from === status && !t.fromAny && t.action !== TaskAction.ASSIGN && t.action !== TaskAction.REASSIGN,
  ).map((t) => ({ action: t.action, requiresComment: Boolean(t.requiresComment) }));
  if (status !== 'CLOSED' && status !== 'CANCELLED') {
    list.push({ action: TaskAction.CANCEL, requiresComment: true });
  }
  return list;
}

export function TaskDetailDrawer({
  taskId,
  members,
  onClose,
  onChanged,
}: {
  taskId: string;
  members: AssignableUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [checkText, setCheckText] = useState('');

  const load = useCallback(async () => {
    try {
      setTask(await apiFetch<TaskDetail>(`/tasks/${taskId}`));
    } catch {
      setError('Could not load task');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function doTransition(action: TaskAction, requiresComment: boolean) {
    let c: string | undefined;
    if (requiresComment) {
      c = window.prompt(`${ACTION_LABEL[action]} — add a comment (required):`) ?? undefined;
      if (!c || !c.trim()) return;
    }
    void act(() =>
      apiFetch(`/tasks/${taskId}/transition`, { method: 'POST', body: JSON.stringify({ action, comment: c }) }),
    );
  }

  function assign(assigneeId: string) {
    if (!assigneeId) return;
    void act(() => apiFetch(`/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId }) }));
  }

  function addComment() {
    if (!comment.trim()) return;
    void act(async () => {
      await apiFetch(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) });
      setComment('');
    });
  }

  function addChecklist() {
    if (!checkText.trim()) return;
    void act(async () => {
      await apiFetch(`/tasks/${taskId}/checklist`, { method: 'POST', body: JSON.stringify({ text: checkText }) });
      setCheckText('');
    });
  }

  const actions = task ? availableActions(task.status) : [];
  const canAssign = task && (task.status === 'DRAFT' || task.status === 'ASSIGNED');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!task ? (
          <div className="p-6 text-sm text-slate-500">{error ?? 'Loading…'}</div>
        ) : (
          <div className="flex flex-col gap-5 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[task.status] ?? 'slate'}>{task.status.replace(/_/g, ' ')}</Badge>
                  {task.overdue ? <Badge tone="red">Overdue</Badge> : null}
                  {task.clientFacing ? <Badge tone="blue">Client-facing</Badge> : null}
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-800">{task.title}</h2>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {task.description ? <p className="text-sm text-slate-600">{task.description}</p> : null}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Assignee" value={task.assignee?.name ?? 'Unassigned'} />
              <Field label="Priority" value={task.priority} />
              <Field label="Module" value={task.module?.name ?? '—'} />
              <Field label="Estimate" value={task.estimatedHours ? `${task.estimatedHours}h` : '—'} />
              <Field label="Deadline" value={task.deadline ? new Date(task.deadline).toLocaleDateString() : '—'} />
            </div>

            {error ? <p className="text-xs text-slate-900">{error}</p> : null}

            {/* Assign + transitions */}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</div>
              {canAssign ? (
                <div className="mt-2">
                  <select
                    defaultValue=""
                    disabled={busy}
                    onChange={(e) => assign(e.target.value)}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  >
                    <option value="" disabled>
                      {task.status === 'DRAFT' ? 'Assign to…' : 'Reassign to…'}
                    </option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role}){m.resourceType === 'FREELANCE' ? ' · freelance' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.length === 0 && !canAssign ? (
                  <span className="text-sm text-slate-400">No actions from this status.</span>
                ) : null}
                {actions.map(({ action, requiresComment }) => (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === TaskAction.CANCEL ? 'danger' : action === TaskAction.SEND_BACK ? 'outline' : 'primary'}
                    disabled={busy}
                    onClick={() => doTransition(action, requiresComment)}
                  >
                    {ACTION_LABEL[action] ?? action}
                  </Button>
                ))}
              </div>
            </div>

            {/* Subtasks */}
            {task.subtasks.length > 0 ? (
              <Section title="Subtasks">
                <ul className="flex flex-col gap-1 text-sm">
                  {task.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center justify-between">
                      <span className="text-slate-700">{s.title}</span>
                      <Badge tone={STATUS_TONE[s.status] ?? 'slate'}>{s.status.replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {/* Checklist */}
            <Section title="Checklist">
              <ul className="flex flex-col gap-1">
                {task.checklist.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={c.done}
                        disabled={busy}
                        onChange={() =>
                          act(() => apiFetch(`/tasks/${taskId}/checklist/${c.id}/toggle`, { method: 'POST', body: '{}' }))
                        }
                      />
                      <span className={c.done ? 'text-slate-400 line-through' : ''}>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Input
                  placeholder="Add checklist item…"
                  value={checkText}
                  onChange={(e) => setCheckText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addChecklist()}
                />
                <Button size="sm" variant="outline" disabled={busy} onClick={addChecklist}>
                  Add
                </Button>
              </div>
            </Section>

            {/* Files */}
            <TaskFiles taskId={taskId} />

            {/* Comments */}
            <Section title="Comments">
              <ul className="flex flex-col gap-2">
                {task.comments.map((c) => (
                  <li key={c.id} className="rounded-md bg-slate-50 p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-700">{c.author?.name ?? 'Unknown'}</span>
                      {c.visibility === 'CLIENT_VISIBLE' ? <Badge tone="blue">Client-visible</Badge> : null}
                      <span className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-slate-600">{c.body}</div>
                  </li>
                ))}
                {task.comments.length === 0 ? <li className="text-sm text-slate-400">No comments.</li> : null}
              </ul>
              <div className="mt-2 flex gap-2">
                <Input placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button size="sm" disabled={busy} onClick={addComment}>
                  Post
                </Button>
              </div>
            </Section>

            {/* History */}
            <Section title="History">
              <ol className="flex flex-col gap-1.5 text-xs">
                {task.history.map((h) => (
                  <li key={h.id} className="flex gap-2">
                    <span className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</span>
                    <span className="text-slate-600">
                      {h.fromStatus ? `${h.fromStatus.replace(/_/g, ' ')} → ` : ''}
                      <span className="font-medium">{h.toStatus.replace(/_/g, ' ')}</span>
                      {h.actorEmail ? ` · ${h.actorEmail}` : ''}
                      {h.comment ? ` — "${h.comment}"` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}
