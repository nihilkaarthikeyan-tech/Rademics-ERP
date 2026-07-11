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
  INVOICED: 'INVOICED',
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
  APPROVE_REVIEW: 'APPROVE_REVIEW', // PM/TL approve of Submitted for Review
  SEND_BACK: 'SEND_BACK',
  CLIENT_APPROVE: 'CLIENT_APPROVE',
  CLIENT_REQUEST_REVISION: 'CLIENT_REQUEST_REVISION',
  MARK_INVOICED: 'MARK_INVOICED',
  CLOSE: 'CLOSE',
  CLOSE_WITHOUT_INVOICING: 'CLOSE_WITHOUT_INVOICING',
  CANCEL: 'CANCEL',
} as const;

export type TaskAction = (typeof TaskAction)[keyof typeof TaskAction];

/** Who may perform an action (role names align with @rademics/permissions Role). */
export type TransitionActor =
  | 'PM'
  | 'TEAM_LEAD'
  | 'ASSIGNEE'
  | 'CLIENT_APPROVER'
  | 'FINANCE';

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
  { from: TaskStatus.DRAFT, action: TaskAction.ASSIGN, to: TaskStatus.ASSIGNED, actors: ['PM', 'TEAM_LEAD'] },
  { from: TaskStatus.ASSIGNED, action: TaskAction.ACKNOWLEDGE, to: TaskStatus.ACKNOWLEDGED, actors: ['ASSIGNEE'] },
  { from: TaskStatus.ASSIGNED, action: TaskAction.REASSIGN, to: TaskStatus.ASSIGNED, actors: ['PM', 'TEAM_LEAD'] },
  { from: TaskStatus.ACKNOWLEDGED, action: TaskAction.START_WORK, to: TaskStatus.IN_PROGRESS, actors: ['ASSIGNEE'] },
  { from: TaskStatus.IN_PROGRESS, action: TaskAction.SUBMIT, to: TaskStatus.SUBMITTED_FOR_REVIEW, actors: ['ASSIGNEE'] },
  {
    from: TaskStatus.SUBMITTED_FOR_REVIEW,
    action: TaskAction.APPROVE_REVIEW,
    conditional: { ifClientFacing: TaskStatus.CLIENT_REVIEW, otherwise: TaskStatus.COMPLETED },
    actors: ['PM', 'TEAM_LEAD'],
  },
  {
    from: TaskStatus.SUBMITTED_FOR_REVIEW,
    action: TaskAction.SEND_BACK,
    to: TaskStatus.IN_PROGRESS,
    actors: ['PM', 'TEAM_LEAD'],
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
  { from: TaskStatus.COMPLETED, action: TaskAction.MARK_INVOICED, to: TaskStatus.INVOICED, actors: ['FINANCE'] },
  { from: TaskStatus.INVOICED, action: TaskAction.CLOSE, to: TaskStatus.CLOSED, actors: ['PM'] },
  { from: TaskStatus.COMPLETED, action: TaskAction.CLOSE_WITHOUT_INVOICING, to: TaskStatus.CLOSED, actors: ['PM'] },
  { from: TaskStatus.DRAFT, action: TaskAction.CANCEL, to: TaskStatus.CANCELLED, actors: ['PM'], requiresComment: true, fromAny: true },
] as const;

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
