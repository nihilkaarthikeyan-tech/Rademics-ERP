/**
 * Task Status State Machine — Spec §6 (the spine of the system).
 *
 * Statuses and legal transitions are EXHAUSTIVE: no other transitions may be
 * possible from the UI or the API. The full engine + rejection tests land in
 * Phase 4; this file is the canonical, shared definition both API and UI use.
 *
 * - "Deadline-overdue is a computed flag, not a status" (§6) — so it is NOT here.
 * - Send-back and revision-request comments are mandatory (§6).
 */

export const TaskStatus = {
  DRAFT: 'DRAFT',
  ASSIGNED: 'ASSIGNED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED_FOR_REVIEW: 'SUBMITTED_FOR_REVIEW',
  CLIENT_REVIEW: 'CLIENT_REVIEW',
  COMPLETED: 'COMPLETED',
  // INVOICED was removed 2026-07-26: billing lives in the Finance module and is
  // not a step of the task chain. A completed task is simply closed by whoever
  // runs the project.
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskAction = {
  ASSIGN: 'ASSIGN',
  ACKNOWLEDGE: 'ACKNOWLEDGE',
  REASSIGN: 'REASSIGN',
  START_WORK: 'START_WORK',
  SUBMIT: 'SUBMIT',
  APPROVE_REVIEW: 'APPROVE_REVIEW', // project manager / TL approve of Submitted for Review
  SEND_BACK: 'SEND_BACK',
  CLIENT_APPROVE: 'CLIENT_APPROVE',
  CLIENT_REQUEST_REVISION: 'CLIENT_REQUEST_REVISION',
  // MARK_INVOICED / CLOSE_WITHOUT_INVOICING removed 2026-07-26 with the
  // invoicing step (billing is Finance-module work, not a task transition).
  CLOSE: 'CLOSE',
  CANCEL: 'CANCEL',
} as const;

export type TaskAction = (typeof TaskAction)[keyof typeof TaskAction];

/**
 * Who may perform an action.
 *
 * `PROJECT_MANAGER` is NOT a role (PM was removed on 2026-07-25) — it means
 * "the person appointed to this task's project, or HR / Super Admin". Every
 * other actor here is a role name aligning with @rademics/permissions Role,
 * except ASSIGNEE (the task's own assignee) and CLIENT_APPROVER.
 */
export type TransitionActor =
  | 'PROJECT_MANAGER'
  | 'TEAM_LEAD'
  | 'ASSIGNEE'
  | 'CLIENT_APPROVER';

export interface TaskTransition {
  from: TaskStatus;
  action: TaskAction;
  /** Fixed target status. Omitted when the target is conditional (see `conditional`). */
  to?: TaskStatus;
  /** For §6's conditional Approve: Client Review if client-facing, else Completed. */
  conditional?: {
    ifClientFacing: TaskStatus;
    otherwise: TaskStatus;
  };
  actors: TransitionActor[];
  requiresComment?: boolean;
  /** Applies from every status except Closed (the §6 "Any except Closed → Cancel" row). */
  fromAny?: boolean;
}

/** Legal transitions, transcribed verbatim from the §6 table. */
export const TASK_TRANSITIONS: readonly TaskTransition[] = [
  { from: TaskStatus.DRAFT, action: TaskAction.ASSIGN, to: TaskStatus.ASSIGNED, actors: ['PROJECT_MANAGER', 'TEAM_LEAD'] },
  { from: TaskStatus.ASSIGNED, action: TaskAction.ACKNOWLEDGE, to: TaskStatus.ACKNOWLEDGED, actors: ['ASSIGNEE'] },
  { from: TaskStatus.ASSIGNED, action: TaskAction.REASSIGN, to: TaskStatus.ASSIGNED, actors: ['PROJECT_MANAGER', 'TEAM_LEAD'] },
  { from: TaskStatus.ACKNOWLEDGED, action: TaskAction.START_WORK, to: TaskStatus.IN_PROGRESS, actors: ['ASSIGNEE'] },
  { from: TaskStatus.IN_PROGRESS, action: TaskAction.SUBMIT, to: TaskStatus.SUBMITTED_FOR_REVIEW, actors: ['ASSIGNEE'] },
  {
    from: TaskStatus.SUBMITTED_FOR_REVIEW,
    action: TaskAction.APPROVE_REVIEW,
    conditional: { ifClientFacing: TaskStatus.CLIENT_REVIEW, otherwise: TaskStatus.COMPLETED },
    actors: ['PROJECT_MANAGER', 'TEAM_LEAD'],
  },
  {
    from: TaskStatus.SUBMITTED_FOR_REVIEW,
    action: TaskAction.SEND_BACK,
    to: TaskStatus.IN_PROGRESS,
    actors: ['PROJECT_MANAGER', 'TEAM_LEAD'],
    requiresComment: true,
  },
  { from: TaskStatus.CLIENT_REVIEW, action: TaskAction.CLIENT_APPROVE, to: TaskStatus.COMPLETED, actors: ['CLIENT_APPROVER'] },
  {
    from: TaskStatus.CLIENT_REVIEW,
    action: TaskAction.CLIENT_REQUEST_REVISION,
    to: TaskStatus.IN_PROGRESS,
    actors: ['CLIENT_APPROVER'],
    requiresComment: true,
  },
  { from: TaskStatus.COMPLETED, action: TaskAction.CLOSE, to: TaskStatus.CLOSED, actors: ['PROJECT_MANAGER'] },
  { from: TaskStatus.DRAFT, action: TaskAction.CANCEL, to: TaskStatus.CANCELLED, actors: ['PROJECT_MANAGER'], requiresComment: true, fromAny: true },
] as const;

/**
 * Who the viewer is relative to one task — everything canPerform needs.
 * `pmId` is the task's project's appointed manager (Project.pmId).
 */
export interface TaskViewerCtx {
  meId: string;
  meRole: string;
  assigneeId: string | null;
  pmId: string | null;
}

/**
 * UI mirror of the API's assertActor (apps/api/src/projects/tasks.service.ts).
 * MUST stay in lockstep with it: the staff app uses this to decide which action
 * buttons exist at all, so a drift either hides a legal action or renders a
 * button the server will 403. The parity test in task-status.test.ts walks
 * every transition — extend it whenever an actor rule changes.
 *
 * CLIENT_APPROVER resolves to false here on purpose: client actions belong to
 * the portal and never render in the staff app.
 */
export function canPerform(actors: readonly TransitionActor[], ctx: TaskViewerCtx): boolean {
  return actors.some((actor) => {
    switch (actor) {
      case 'ASSIGNEE':
        return ctx.assigneeId !== null && ctx.assigneeId === ctx.meId;
      case 'PROJECT_MANAGER':
        return (
          (ctx.pmId !== null && ctx.pmId === ctx.meId) ||
          ctx.meRole === 'SUPER_ADMIN' ||
          ctx.meRole === 'HR'
        );
      case 'TEAM_LEAD':
        return ctx.meRole === 'TEAM_LEAD' || ctx.meRole === 'SUPER_ADMIN';
      case 'CLIENT_APPROVER':
        return false;
      default:
        return false;
    }
  });
}

/**
 * The transition buttons this viewer may legally press from `status`.
 * Assign/reassign and cancel are separate affordances (the assign picker and
 * canCancelTask) and are excluded here.
 */
export function visibleTaskActions(
  status: TaskStatus,
  ctx: TaskViewerCtx,
): { action: TaskAction; requiresComment: boolean }[] {
  return TASK_TRANSITIONS.filter(
    (t) =>
      t.from === status &&
      !t.fromAny &&
      t.action !== TaskAction.ASSIGN &&
      t.action !== TaskAction.REASSIGN &&
      canPerform(t.actors, ctx),
  ).map((t) => ({ action: t.action, requiresComment: Boolean(t.requiresComment) }));
}

/**
 * Cancel is the §6 "Any except Closed" row, restricted to the project's manager
 * (appointed pm, HR or Super Admin — never Team Lead). Also hidden on CANCELLED:
 * re-cancelling is legal server-side but meaningless to offer.
 */
export function canCancelTask(status: TaskStatus, ctx: TaskViewerCtx): boolean {
  return (
    status !== TaskStatus.CLOSED &&
    status !== TaskStatus.CANCELLED &&
    canPerform(['PROJECT_MANAGER'], ctx)
  );
}

/**
 * Resolve the next status for a (from, action) pair, honouring the client-facing
 * branch and the "Any except Closed → Cancel" rule. Returns null if the transition
 * is illegal — the API MUST reject illegal transitions (§6, §13 Projects & Tasks).
 */
export function nextTaskStatus(
  from: TaskStatus,
  action: TaskAction,
  opts: { clientFacing: boolean },
): TaskStatus | null {
  // Cancel applies from any status except Closed.
  if (action === TaskAction.CANCEL) {
    return from === TaskStatus.CLOSED ? null : TaskStatus.CANCELLED;
  }
  const t = TASK_TRANSITIONS.find((x) => x.from === from && x.action === action && !x.fromAny);
  if (!t) return null;
  if (t.conditional) {
    return opts.clientFacing ? t.conditional.ifClientFacing : t.conditional.otherwise;
  }
  return t.to ?? null;
}
