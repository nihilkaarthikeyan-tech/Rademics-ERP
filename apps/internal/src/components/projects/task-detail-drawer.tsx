'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Hourglass,
  ShieldCheck,
  Timer,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';
import { Badge, Button, Input } from '@rademics/ui';
import {
  TaskAction,
  canCancelTask,
  canPerform,
  visibleTaskActions,
  type TaskStatus,
  type TaskViewerCtx,
} from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { TaskFiles } from './task-files';

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  resourceType: string;
  /** Live workload: tasks not yet finished. Lets the assigner pick the free person. */
  openTasks?: number;
}

interface HistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  actorEmail: string | null;
  comment: string | null;
  createdAt: string;
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
  project: { id: string; name: string; pmId: string | null };
  subtasks: { id: string; title: string; status: string }[];
  checklist: { id: string; text: string; done: boolean }[];
  history: HistoryEntry[];
  comments: { id: string; body: string; visibility: string; author: { name: string } | null; createdAt: string }[];
}

/** SNAKE_CASE never reaches the screen — one label map used everywhere. */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ASSIGNED: 'Assigned',
  ACKNOWLEDGED: 'Accepted',
  IN_PROGRESS: 'In progress',
  SUBMITTED_FOR_REVIEW: 'In review',
  CLIENT_REVIEW: 'With the client',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red' | 'blue'> = {
  DRAFT: 'slate', ASSIGNED: 'blue', ACKNOWLEDGED: 'blue', IN_PROGRESS: 'amber',
  SUBMITTED_FOR_REVIEW: 'amber', CLIENT_REVIEW: 'amber', COMPLETED: 'green',
  INVOICED: 'green', CLOSED: 'slate', CANCELLED: 'red',
};

const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'slate'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };
const PRIORITY_LABEL: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

const ACTION_LABEL: Record<string, string> = {
  ACKNOWLEDGE: 'Accept task',
  START_WORK: 'Start work',
  SUBMIT: 'Submit for review',
  APPROVE_REVIEW: 'Approve',
  SEND_BACK: 'Send back…',
  MARK_INVOICED: 'Mark invoiced',
  CLOSE: 'Close task',
  CLOSE_WITHOUT_INVOICING: 'Close without invoicing',
};

/** Forward movement — rendered as the primary button, before any outline action. */
const FORWARD_ACTIONS: string[] = [
  TaskAction.ACKNOWLEDGE, TaskAction.START_WORK, TaskAction.SUBMIT,
  TaskAction.APPROVE_REVIEW, TaskAction.MARK_INVOICED, TaskAction.CLOSE,
];

/** Statuses where "Overdue" would just shout at finished work. */
const SETTLED = ['COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED'];

// Same rendering as the dashboard's people initials (dashboard-overview.tsx) —
// copied, not imported: components don't reach across app areas for 3 lines.
// Punctuation is dropped first, so "Tara (Team Lead)" reads TT, not "T(".
function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** The kit's outline variant is white-on-white against the glass hero card —
 *  secondary actions in there need a visible edge. */
const OUTLINE_ON_GLASS = 'border-slate-300 bg-white/90 hover:bg-white';

function relTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

/** "TEAM_LEAD" → "Team lead" for the assign picker. */
function roleLabel(role: string): string {
  const words = role.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "3 days late" / "in 5 days" — a date alone doesn't say whether to worry. */
function deadlineNote(deadline: string): string | null {
  const days = Math.round((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'due today';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`;
  if (days <= 7) return `in ${days} day${days === 1 ? '' : 's'}`;
  return null;
}

/** Raw emails never render: prefer the members list, else prettify the local part. */
function actorName(email: string | null, members: AssignableUser[]): string {
  if (!email) return 'Someone';
  const known = members.find((m) => m.email === email);
  if (known) return known.name;
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || 'Someone'
  );
}

/** One plain-English sentence per history entry. Client actions carry no actor —
 *  the client's own name never shows to staff beyond "The client". */
function activityPhrase(h: HistoryEntry, actor: string): { actor: string | null; verb: string } {
  switch (h.action) {
    case 'ASSIGN': return { actor, verb: 'assigned the task' };
    case 'REASSIGN': return { actor, verb: 'reassigned the task' };
    case 'ACKNOWLEDGE': return { actor, verb: 'accepted the task' };
    case 'START_WORK': return { actor, verb: 'started work' };
    case 'SUBMIT': return { actor, verb: 'submitted it for review' };
    case 'APPROVE_REVIEW':
      return { actor, verb: h.toStatus === 'CLIENT_REVIEW' ? 'approved it and sent it to the client' : 'approved the work' };
    case 'SEND_BACK': return { actor, verb: 'sent it back for changes' };
    case 'CLIENT_APPROVE': return { actor: null, verb: 'The client approved the work' };
    case 'CLIENT_REQUEST_REVISION': return { actor: null, verb: 'The client asked for changes' };
    case 'MARK_INVOICED': return { actor, verb: 'marked it invoiced' };
    case 'CLOSE': return { actor, verb: 'closed the task' };
    case 'CLOSE_WITHOUT_INVOICING': return { actor, verb: 'closed it without invoicing' };
    case 'CANCEL': return { actor, verb: 'cancelled the task' };
    default: return { actor, verb: `moved it to ${STATUS_LABEL[h.toStatus] ?? h.toStatus}` };
  }
}

/** The pipeline the stepper draws — 8 segments, 9 when the client signs off. */
function pipelineStages(clientFacing: boolean): string[] {
  return [
    'Draft', 'Assigned', 'Accepted', 'In progress', 'In review',
    ...(clientFacing ? ['With the client'] : []),
    'Completed', 'Invoiced', 'Closed',
  ];
}

function stageIndex(status: TaskStatus, clientFacing: boolean): number {
  const order: string[] = [
    'DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW',
    ...(clientFacing ? ['CLIENT_REVIEW'] : []),
    'COMPLETED', 'INVOICED', 'CLOSED',
  ];
  const i = order.indexOf(status);
  // A non-client-facing task can't be in CLIENT_REVIEW; if data ever says so, sit it at review.
  if (i === -1) return status === 'CLIENT_REVIEW' ? 4 : 0;
  return i;
}

function Avatar({ name, className = 'h-7 w-7 text-[11px]' }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent/10 font-semibold text-accent ${className}`}
    >
      {initials(name)}
    </span>
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

export function TaskDetailDrawer({
  taskId,
  members,
  onClose,
  onChanged,
  pm,
  clientName,
}: {
  taskId: string;
  members: AssignableUser[];
  onClose: () => void;
  onChanged: () => void;
  /** The project's appointed manager, when the caller has it loaded — used only
   *  for names in copy. Eligibility always comes from the task's own project.pmId. */
  pm?: { id: string; name: string } | null;
  clientName?: string | null;
}) {
  const me = useMe();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [checkText, setCheckText] = useState('');
  const [pendingAction, setPendingAction] = useState<{ action: TaskAction; requiresComment: boolean } | null>(null);
  const [actionComment, setActionComment] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignPick, setAssignPick] = useState<AssignableUser | null>(null);
  const [confirmSkipInvoice, setConfirmSkipInvoice] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const anyPanelOpen = pendingAction !== null || assignOpen || confirmSkipInvoice;

  const load = useCallback(async () => {
    try {
      setTask(await apiFetch<TaskDetail>(`/tasks/${taskId}`));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the open inline panel first; with none open it closes the drawer.
  const closePanels = useCallback(() => {
    setPendingAction(null);
    setAssignOpen(false);
    setConfirmSkipInvoice(false);
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (anyPanelOpen) closePanels();
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyPanelOpen, closePanels, onClose]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) {
        // The state moved under us (someone else acted, or a stale view). Refresh
        // rather than parroting "§6 eligible actor" jargon at staff.
        setError("This task changed since you opened it — we've refreshed it.");
        await load();
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function openReason(action: TaskAction, requiresComment: boolean) {
    setAssignOpen(false);
    setConfirmSkipInvoice(false);
    setPendingAction({ action, requiresComment });
    setActionComment('');
  }

  function openAssign() {
    setPendingAction(null);
    setConfirmSkipInvoice(false);
    setAssignOpen(true);
    setAssignQuery('');
    setAssignPick(null);
  }

  function startTransition(action: TaskAction, requiresComment: boolean) {
    if (action === TaskAction.CLOSE_WITHOUT_INVOICING) {
      setPendingAction(null);
      setAssignOpen(false);
      setConfirmSkipInvoice(true);
      return;
    }
    if (requiresComment || action === TaskAction.CANCEL) {
      openReason(action, requiresComment);
      return;
    }
    runTransition(action);
  }

  function runTransition(action: TaskAction, commentText?: string) {
    void act(async () => {
      await apiFetch(`/tasks/${taskId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ action, comment: commentText }),
      });
      closePanels();
    });
  }

  function confirmAssign() {
    if (!assignPick) return;
    void act(async () => {
      await apiFetch(`/tasks/${taskId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigneeId: assignPick.id }),
      });
      closePanels();
    });
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

  // ── Who is looking, and what may they do? Eligibility mirrors the server's
  //    assertActor via the shared helpers; the pmId comes from the task itself,
  //    so this is correct from My Work too, where the caller has no project. ──
  const pmId = task?.project?.pmId ?? pm?.id ?? null;
  const pmName = pm?.name ?? (pmId ? members.find((m) => m.id === pmId)?.name ?? null : null);
  const ctx: TaskViewerCtx = {
    meId: me.id,
    meRole: me.role,
    assigneeId: task?.assignee?.id ?? null,
    pmId,
  };
  const isManager = canPerform(['PROJECT_MANAGER'], ctx);
  const isLead = canPerform(['TEAM_LEAD'], ctx);
  const isAssignee = !!task?.assignee && task.assignee.id === me.id;
  const myActions = task ? visibleTaskActions(task.status, ctx) : [];
  const cancelable = task ? canCancelTask(task.status, ctx) : false;
  const isTerminal = task?.status === 'CLOSED' || task?.status === 'CANCELLED';
  const canManageAssignment =
    !!task && (isManager || isLead) && members.length > 0 && (task.status === 'DRAFT' || task.status === 'ASSIGNED');

  const assigneeName = task?.assignee?.name ?? null;
  const pmDisplay = pmName ?? 'a project manager';
  const clientDisplay = clientName ?? 'the client';

  const history = task?.history ?? [];
  const newest = history[history.length - 1] ?? null;
  const assignedEntry = [...history].reverse().find((h) => h.action === 'ASSIGN' || h.action === 'REASSIGN') ?? null;

  /** Zone B: exactly one of "Your move" / "Waiting" per viewer, always specific. */
  function turnLine(): { chip: 'your' | 'waiting'; text: React.ReactNode; avatar: string | null } {
    const t = task!;
    const name = (n: string) => <span className="font-medium text-slate-800">{n}</span>;

    // A live task with nobody on it is an anomaly worth naming, not hiding.
    if (!t.assignee && ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(t.status)) {
      return isManager || isLead
        ? { chip: 'your', text: <>No assignee — assign someone to keep it moving.</>, avatar: null }
        : { chip: 'waiting', text: <>Waiting for an assignee.</>, avatar: null };
    }

    switch (t.status) {
      case 'DRAFT':
        return canManageAssignment
          ? { chip: 'your', text: <>Pick someone to get this moving.</>, avatar: null }
          : { chip: 'waiting', text: <>Not assigned yet — waiting for {name(pmDisplay)} to assign it.</>, avatar: null };
      case 'ASSIGNED':
        return isAssignee
          ? {
              chip: 'your',
              text: <>This task is yours — accept it so {name(pmName ?? 'the team')} knows you&apos;ve seen it.</>,
              avatar: assigneeName,
            }
          : {
              chip: 'waiting',
              text: (
                <>
                  Waiting for {name(assigneeName!)} to accept the task.
                  {assignedEntry ? (
                    <span className="ml-1.5 text-xs text-slate-400">assigned {relTime(assignedEntry.createdAt)}</span>
                  ) : null}
                </>
              ),
              avatar: assigneeName,
            };
      case 'ACKNOWLEDGED':
        return isAssignee
          ? { chip: 'your', text: <>You&apos;ve accepted — start when you&apos;re ready.</>, avatar: assigneeName }
          : { chip: 'waiting', text: <>Waiting for {name(assigneeName!)} to start work.</>, avatar: assigneeName };
      case 'IN_PROGRESS':
        return isAssignee
          ? { chip: 'your', text: <>You&apos;re on this. Submit it when it&apos;s ready for review.</>, avatar: assigneeName }
          : {
              chip: 'waiting',
              text: <>{name(assigneeName!)} is working on this. Next: they submit it for review.</>,
              avatar: assigneeName,
            };
      case 'SUBMITTED_FOR_REVIEW':
        if (isManager || isLead)
          return {
            chip: 'your',
            text: <>{name(assigneeName ?? 'The assignee')} submitted this for your review.</>,
            avatar: assigneeName,
          };
        if (isAssignee)
          return {
            chip: 'waiting',
            text: <>Your work is with {name(pmDisplay)} for review — nothing more for you right now.</>,
            avatar: null,
          };
        return { chip: 'waiting', text: <>Waiting for {name(pmDisplay)} to review the submitted work.</>, avatar: null };
      case 'CLIENT_REVIEW':
        return {
          chip: 'waiting',
          text: <>With {name(clientDisplay)} for sign-off. It moves on its own when they approve or ask for changes.</>,
          avatar: null,
        };
      case 'COMPLETED':
        if (canPerform(['FINANCE'], ctx))
          return { chip: 'your', text: <>Work approved — mark it invoiced once it&apos;s on an invoice.</>, avatar: null };
        if (isManager)
          return {
            chip: 'waiting',
            text: <>Waiting for Finance to invoice this. You can close it without invoicing instead.</>,
            avatar: null,
          };
        return { chip: 'waiting', text: <>Work approved. Waiting for Finance to invoice it.</>, avatar: null };
      case 'INVOICED':
        return isManager
          ? { chip: 'your', text: <>Invoiced — close the task to wrap it up.</>, avatar: null }
          : { chip: 'waiting', text: <>Invoiced — waiting for {name(pmDisplay)} to close it.</>, avatar: null };
      default:
        return { chip: 'waiting', text: <>Nothing pending.</>, avatar: null };
    }
  }

  /** One line under the buttons telling the viewer what their primary click does. */
  function consequence(action: TaskAction): string | null {
    switch (action) {
      case TaskAction.ACKNOWLEDGE:
        return `This tells ${pmName ?? 'the team'} you've seen it — the task waits here until you accept.`;
      case TaskAction.START_WORK:
        return 'Moves it to In progress.';
      case TaskAction.SUBMIT:
        return `Sends it to ${pmDisplay} for review.`;
      case TaskAction.APPROVE_REVIEW:
        return task?.clientFacing ? 'Approving sends it to the client for sign-off.' : 'Approving marks it completed.';
      case TaskAction.MARK_INVOICED:
        return 'Records that this work is on an invoice.';
      case TaskAction.CLOSE:
        return 'Wraps it up for good.';
      default:
        return null;
    }
  }

  const forward = myActions.filter((a) => FORWARD_ACTIONS.includes(a.action));
  const sendBack = myActions.find((a) => a.action === TaskAction.SEND_BACK) ?? null;
  const skipInvoice = myActions.find((a) => a.action === TaskAction.CLOSE_WITHOUT_INVOICING) ?? null;
  const hasZoneC =
    forward.length > 0 || sendBack !== null || skipInvoice !== null || canManageAssignment;
  const firstForward = forward[0] ?? null;
  const primaryCaption = firstForward ? consequence(firstForward.action) : null;

  const filteredMembers = members.filter((m) => {
    const q = assignQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  });
  const pickIsCurrent = !!assignPick && assignPick.id === task?.assignee?.id;
  const pickFirstName = assignPick?.name.split(/\s+/)[0] ?? '';

  const activity = [...history].reverse();
  const shownActivity = showAllActivity ? activity : activity.slice(0, 5);
  const returnedNote =
    task?.status === 'IN_PROGRESS' && newest && (newest.action === 'SEND_BACK' || newest.action === 'CLIENT_REQUEST_REVISION')
      ? newest
      : null;
  const cancelEntry = [...history].reverse().find((h) => h.action === 'CANCEL') ?? null;
  const closedQuietly =
    history.some((h) => h.action === 'CLOSE_WITHOUT_INVOICING') && !history.some((h) => h.action === 'MARK_INVOICED');

  const stages = task ? pipelineStages(task.clientFacing) : [];
  const currentStage = task ? stageIndex(task.status, task.clientFacing) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30"
      onClick={() => {
        // A stray click outside must never eat a typed reason or a picked person.
        if (!anyPanelOpen) onClose();
      }}
    >
      <div
        className="drawer-in h-full w-full max-w-xl overflow-y-auto border-l border-white/70 bg-white/85 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loadFailed ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-slate-500">Could not load task.</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : !task ? (
          <div className="flex flex-col gap-4 p-6">
            <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <>
            {/* ── Sticky header: status + title stay while the body scrolls ── */}
            <div className="sticky top-0 z-10 border-b border-white/60 bg-white/80 px-6 py-4 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[task.status] ?? 'slate'}>{STATUS_LABEL[task.status] ?? task.status}</Badge>
                  {task.overdue && !SETTLED.includes(task.status) ? <Badge tone="red">Overdue</Badge> : null}
                  {task.clientFacing ? <Badge tone="blue">Client-facing</Badge> : null}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close task panel"
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <h2 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-slate-900">{task.title}</h2>
            </div>

            <div className="flex flex-col gap-6 p-6">
              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

              {/* ── Hero card: where it is → whose move → what you can do ── */}
              {isTerminal ? (
                task.status === 'CLOSED' ? (
                  <div className="flex items-start gap-2 rounded-lg bg-slate-100/80 px-4 py-3 text-sm text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>
                      {closedQuietly
                        ? 'Closed without invoicing — finished, and deliberately not billed.'
                        : 'Closed — this task is finished. Nothing more happens to it.'}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                    <div className="flex items-start gap-2">
                      <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {cancelEntry
                          ? `Cancelled ${new Date(cancelEntry.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} by ${actorName(cancelEntry.actorEmail, members)}.`
                          : 'This task was cancelled.'}
                      </span>
                    </div>
                    {cancelEntry?.comment ? (
                      <p className="ml-6 mt-1 border-l-2 border-rose-200 pl-2 italic text-slate-500">
                        &ldquo;{cancelEntry.comment}&rdquo;
                      </p>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="rounded-xl border border-white/70 bg-white/60 p-4 shadow-glass backdrop-blur-xl">
                  {/* Zone A — the pipeline. Index-based fill: after a send-back the
                      bar truthfully drops back to In progress. */}
                  <div className="flex gap-1">
                    {stages.map((stage, i) => (
                      <div
                        key={stage}
                        title={stage}
                        aria-current={i === currentStage ? 'step' : undefined}
                        className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                          i < currentStage ? 'bg-accent' : i === currentStage ? 'bg-accent/40' : 'bg-slate-200/80'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-slate-800">{stages[currentStage]}</span>
                    <span className="text-xs text-slate-400">
                      Step {currentStage + 1} of {stages.length}
                    </span>
                  </div>

                  <div className="my-3 border-t border-slate-100" />

                  {/* Zone B — whose move is it, in one sentence. */}
                  {(() => {
                    const turn = turnLine();
                    return (
                      <div className="flex items-center gap-2.5">
                        {turn.avatar ? (
                          <Avatar name={turn.avatar} />
                        ) : (
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                            <Clock className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {turn.chip === 'your' ? (
                          <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                            Your move
                          </span>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                            <Hourglass className="h-3 w-3" /> Waiting
                          </span>
                        )}
                        <span className="text-sm text-slate-700">{turn.text}</span>
                      </div>
                    );
                  })()}

                  {returnedNote ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                      <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Returned for changes{returnedNote.comment ? <>: &ldquo;{returnedNote.comment}&rdquo;</> : '.'}
                      </span>
                    </p>
                  ) : null}

                  {/* Zone C — only buttons THIS viewer may press. Nothing here can 403. */}
                  {hasZoneC ? (
                    <>
                      <div className="my-3 border-t border-slate-100" />
                      <div className="flex flex-wrap items-center gap-2">
                        {task.status === 'DRAFT' && canManageAssignment ? (
                          <Button size="sm" disabled={busy || anyPanelOpen} onClick={openAssign}>
                            Assign to someone…
                          </Button>
                        ) : null}
                        {forward.map(({ action, requiresComment }) => (
                          <Button
                            key={action}
                            size="sm"
                            disabled={busy || anyPanelOpen}
                            onClick={() => startTransition(action, requiresComment)}
                          >
                            {ACTION_LABEL[action] ?? action}
                          </Button>
                        ))}
                        {task.status === 'ASSIGNED' && canManageAssignment ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className={OUTLINE_ON_GLASS}
                            disabled={busy || anyPanelOpen}
                            onClick={openAssign}
                          >
                            Reassign…
                          </Button>
                        ) : null}
                        {sendBack ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className={OUTLINE_ON_GLASS}
                            disabled={busy || anyPanelOpen}
                            onClick={() => openReason(TaskAction.SEND_BACK, true)}
                          >
                            {ACTION_LABEL.SEND_BACK}
                          </Button>
                        ) : null}
                        {skipInvoice ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className={OUTLINE_ON_GLASS}
                            disabled={busy || anyPanelOpen}
                            onClick={() => startTransition(TaskAction.CLOSE_WITHOUT_INVOICING, false)}
                          >
                            {ACTION_LABEL.CLOSE_WITHOUT_INVOICING}
                          </Button>
                        ) : null}
                      </div>
                      {primaryCaption ? <p className="mt-1.5 text-xs text-slate-500">{primaryCaption}</p> : null}

                      {/* Send-back reason — inline, never window.prompt. */}
                      {pendingAction && pendingAction.action === TaskAction.SEND_BACK ? (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3">
                          <p className="text-sm font-medium text-slate-800">Send back — why?</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            The assignee sees this, so say what needs changing.
                          </p>
                          <textarea
                            autoFocus
                            rows={2}
                            value={actionComment}
                            onChange={(e) => setActionComment(e.target.value)}
                            placeholder="What should change…"
                            className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className={OUTLINE_ON_GLASS}
                              onClick={closePanels}
                              disabled={busy}
                            >
                              Keep it
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy || !actionComment.trim()}
                              onClick={() => runTransition(TaskAction.SEND_BACK, actionComment.trim())}
                            >
                              Send back
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {/* Close-without-invoicing confirm — deliberate, but no essay. */}
                      {confirmSkipInvoice ? (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3">
                          <p className="text-sm text-slate-700">
                            Close without invoicing? This skips Finance — only for work that won&apos;t be billed.
                          </p>
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={closePanels} disabled={busy}>
                              Keep it
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={OUTLINE_ON_GLASS}
                              disabled={busy}
                              onClick={() => runTransition(TaskAction.CLOSE_WITHOUT_INVOICING)}
                            >
                              Close it
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {/* Assign / reassign — pick, then confirm. Nothing fires on a click in the list. */}
                      {assignOpen ? (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-slate-800">
                              {task.status === 'DRAFT' ? 'Assign this task' : 'Reassign this task'}
                            </p>
                            <button
                              onClick={closePanels}
                              aria-label="Close the assign panel"
                              className="text-slate-400 hover:text-slate-700"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-2">
                            <Input
                              autoFocus
                              placeholder="Search people…"
                              value={assignQuery}
                              onChange={(e) => setAssignQuery(e.target.value)}
                            />
                          </div>
                          {task.status === 'ASSIGNED' && assigneeName ? (
                            <p className="mt-1.5 text-xs text-slate-500">
                              Currently with {assigneeName}. Reassigning hands it over — both are notified.
                            </p>
                          ) : null}
                          <div className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                            {filteredMembers.map((m) => {
                              const selected = assignPick?.id === m.id;
                              const current = m.id === task.assignee?.id;
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => setAssignPick(m)}
                                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 ${
                                    selected ? 'bg-accent/5 ring-1 ring-accent/30' : ''
                                  }`}
                                >
                                  <Avatar name={m.name} className="h-8 w-8 text-xs" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-slate-800">
                                      {m.name}
                                      {current ? <span className="font-normal text-slate-400"> (current)</span> : null}
                                    </span>
                                    <span className="block text-xs text-slate-500">
                                      {roleLabel(m.role)}
                                      {m.resourceType === 'FREELANCE' ? ' · Freelance' : ''}
                                      {typeof m.openTasks === 'number'
                                        ? ` · ${m.openTasks === 0 ? 'free' : `${m.openTasks} open task${m.openTasks === 1 ? '' : 's'}`}`
                                        : ''}
                                    </span>
                                  </span>
                                  {selected ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                                </button>
                              );
                            })}
                            {filteredMembers.length === 0 ? (
                              <p className="px-2 py-3 text-sm text-slate-400">
                                Nobody matches &ldquo;{assignQuery}&rdquo;.
                              </p>
                            ) : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                            <p className="min-w-0 text-xs text-slate-500">
                              {!assignPick
                                ? 'Pick a person to continue.'
                                : pickIsCurrent
                                  ? `Already assigned to ${assignPick.name}.`
                                  : task.status === 'DRAFT'
                                    ? `Assign to ${assignPick.name}? They're notified straight away and it lands in their My Work.`
                                    : `Move this task to ${assignPick.name}? ${assigneeName ?? 'The current assignee'} loses it and it waits for ${assignPick.name} to accept.`}
                            </p>
                            <div className="flex shrink-0 gap-2">
                              <Button size="sm" variant="ghost" onClick={closePanels} disabled={busy}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                disabled={busy || !assignPick || pickIsCurrent}
                                onClick={confirmAssign}
                              >
                                {busy
                                  ? 'Assigning…'
                                  : task.status === 'DRAFT'
                                    ? assignPick
                                      ? `Assign to ${pickFirstName}`
                                      : 'Assign'
                                    : assignPick
                                      ? `Reassign to ${pickFirstName}`
                                      : 'Reassign'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}

              {task.description ? (
                <p className="text-sm leading-relaxed text-slate-600">{task.description}</p>
              ) : null}

              {/* Quiet facts row — only facts that exist. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5 text-slate-400" />
                  {task.assignee ? (
                    <span className="text-slate-800">
                      {task.assignee.name}
                      {isAssignee ? <span className="font-normal text-slate-400"> (you)</span> : null}
                    </span>
                  ) : (
                    <span className="text-amber-700">Unassigned</span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Flag className="h-3.5 w-3.5 text-slate-400" />
                  <Badge tone={PRIORITY_TONE[task.priority] ?? 'slate'}>
                    {PRIORITY_LABEL[task.priority] ?? task.priority}
                  </Badge>
                </span>
                {task.deadline ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                    <span
                      className={
                        task.overdue && !SETTLED.includes(task.status) ? 'font-medium text-red-600' : 'text-slate-800'
                      }
                    >
                      {new Date(task.deadline).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    {deadlineNote(task.deadline) && !SETTLED.includes(task.status) ? (
                      <span className={`text-xs ${task.overdue ? 'text-red-600' : 'text-slate-500'}`}>
                        {deadlineNote(task.deadline)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {task.module ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-800">
                    <Boxes className="h-3.5 w-3.5 text-slate-400" />
                    {task.module.name}
                  </span>
                ) : null}
                {task.estimatedHours ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-800">
                    <Timer className="h-3.5 w-3.5 text-slate-400" />
                    {task.estimatedHours}h
                  </span>
                ) : null}
                {pmName ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-800">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                    Led by {pmName}
                  </span>
                ) : null}
              </div>

              {task.subtasks.length > 0 ? (
                <Section title={`Subtasks · ${task.subtasks.length}`}>
                  <ul className="flex flex-col gap-1 text-sm">
                    {task.subtasks.map((s) => (
                      <li key={s.id} className="flex items-center justify-between">
                        <span className="text-slate-700">{s.title}</span>
                        <Badge tone={STATUS_TONE[s.status] ?? 'slate'}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              <Section
                title={
                  task.checklist.length > 0
                    ? `Checklist · ${task.checklist.filter((c) => c.done).length}/${task.checklist.length}`
                    : 'Checklist'
                }
              >
                <ul className="flex flex-col gap-1">
                  {task.checklist.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
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

              <TaskFiles taskId={taskId} />

              <Section title="Comments">
                <ul className="flex flex-col gap-2">
                  {task.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={c.author?.name ?? 'Unknown'} className="h-6 w-6 text-[10px]" />
                        <span className="text-sm font-medium text-slate-800">{c.author?.name ?? 'Unknown'}</span>
                        {c.visibility === 'CLIENT_VISIBLE' ? <Badge tone="blue">Client-visible</Badge> : null}
                        <span className="text-xs text-slate-400" title={new Date(c.createdAt).toLocaleString()}>
                          {relTime(c.createdAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm leading-relaxed text-slate-600">{c.body}</div>
                    </li>
                  ))}
                  {task.comments.length === 0 ? (
                    <li className="text-sm text-slate-400">No comments yet — notes posted here stay with the task.</li>
                  ) : null}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Input placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <Button size="sm" disabled={busy} onClick={addComment}>
                    Post
                  </Button>
                </div>
              </Section>

              {activity.length > 0 ? (
                <Section title={`Activity · ${activity.length}`}>
                  <ol className="relative flex flex-col">
                    <span aria-hidden className="absolute bottom-1 left-[2.5px] top-1 w-0.5 bg-slate-200" />
                    {shownActivity.map((h, i) => {
                      const phrase = activityPhrase(h, actorName(h.actorEmail, members));
                      return (
                        <li key={h.id} className="relative pb-3 pl-5 last:pb-0">
                          <span
                            aria-hidden
                            className={`absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-accent' : 'bg-slate-300'}`}
                          />
                          <span className="text-sm text-slate-600">
                            {phrase.actor ? (
                              <>
                                <span className="font-medium text-slate-800">{phrase.actor}</span> {phrase.verb}
                              </>
                            ) : (
                              phrase.verb
                            )}
                          </span>
                          <span className="ml-1.5 text-xs text-slate-400" title={new Date(h.createdAt).toLocaleString()}>
                            {relTime(h.createdAt)}
                          </span>
                          {h.comment ? (
                            <p className="mt-0.5 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">
                              &ldquo;{h.comment}&rdquo;
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {activity.length > 5 ? (
                    <button
                      onClick={() => setShowAllActivity((v) => !v)}
                      className="mt-1 text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                    >
                      {showAllActivity ? 'Show less' : `Show all activity (${activity.length})`}
                    </button>
                  ) : null}
                </Section>
              ) : null}

              {/* Quiet zone: ending the task lives far from the everyday actions. */}
              {cancelable ? (
                <div className="border-t border-slate-200/60 pt-2">
                  {pendingAction && pendingAction.action === TaskAction.CANCEL ? (
                    <div className="mb-2 rounded-lg border border-slate-200 bg-white/80 p-3">
                      <p className="text-sm font-medium text-slate-800">Cancel this task?</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        The task stops here and stays on record with your reason. This cannot be undone.
                      </p>
                      <textarea
                        autoFocus
                        rows={2}
                        value={actionComment}
                        onChange={(e) => setActionComment(e.target.value)}
                        placeholder="Reason for cancelling…"
                        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className={OUTLINE_ON_GLASS}
                          onClick={closePanels}
                          disabled={busy}
                        >
                          Keep it
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy || !actionComment.trim()}
                          onClick={() => runTransition(TaskAction.CANCEL, actionComment.trim())}
                        >
                          Cancel the task
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openReason(TaskAction.CANCEL, true)}
                      className="text-sm text-slate-400 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-50"
                    >
                      Cancel this task…
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
