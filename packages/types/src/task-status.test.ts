import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  TaskAction,
  nextTaskStatus,
  TASK_TRANSITIONS,
  canPerform,
  visibleTaskActions,
  canCancelTask,
  type TaskViewerCtx,
  type TransitionActor,
} from './task-status.js';

describe('Task state machine (Spec §6)', () => {
  it('follows the internal happy path to Completed', () => {
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.ASSIGN)).toBe(TaskStatus.ASSIGNED);
    expect(nextTaskStatus(TaskStatus.ASSIGNED, TaskAction.ACKNOWLEDGE)).toBe(TaskStatus.ACKNOWLEDGED);
    expect(nextTaskStatus(TaskStatus.ACKNOWLEDGED, TaskAction.START_WORK)).toBe(TaskStatus.IN_PROGRESS);
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.SUBMIT)).toBe(TaskStatus.SUBMITTED_FOR_REVIEW);
  });

  it('Approve always goes straight to Completed (2026-07-27: no client-approval step)', () => {
    expect(nextTaskStatus(TaskStatus.SUBMITTED_FOR_REVIEW, TaskAction.APPROVE_REVIEW)).toBe(TaskStatus.COMPLETED);
  });

  it('Cancel is legal from any status except Closed (§6)', () => {
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.CANCEL)).toBe(TaskStatus.CANCELLED);
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.CANCEL)).toBe(TaskStatus.CANCELLED);
    expect(nextTaskStatus(TaskStatus.CLOSED, TaskAction.CANCEL)).toBeNull();
  });

  it('rejects illegal transitions (must be rejected by the API — §6, §13)', () => {
    // Cannot go straight from Draft to In Progress.
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.START_WORK)).toBeNull();
    // Cannot submit something that is only Assigned.
    expect(nextTaskStatus(TaskStatus.ASSIGNED, TaskAction.SUBMIT)).toBeNull();
    // Cannot close something still in progress.
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.CLOSE)).toBeNull();
  });

  it('a completed task closes directly — no invoicing step (2026-07-26)', () => {
    expect(nextTaskStatus(TaskStatus.COMPLETED, TaskAction.CLOSE)).toBe(TaskStatus.CLOSED);
  });

  it('mandatory-comment actions are flagged (§6)', () => {
    const sendBack = TASK_TRANSITIONS.find((t) => t.action === TaskAction.SEND_BACK);
    const cancel = TASK_TRANSITIONS.find((t) => t.action === TaskAction.CANCEL);
    expect(sendBack?.requiresComment).toBe(true);
    expect(cancel?.requiresComment).toBe(true);
  });
});

/**
 * Parity suite for canPerform — the UI mirror of the API's assertActor
 * (apps/api/src/projects/tasks.service.ts). If an actor rule changes on the
 * server, this suite is the tripwire: update BOTH sides together.
 */
describe('Viewer eligibility (UI mirror of assertActor)', () => {
  const ASSIGNEE_ID = 'user-assignee';
  const PM_ID = 'user-appointed-pm';
  const onTask = (meId: string, meRole: string): TaskViewerCtx => ({
    meId,
    meRole,
    assigneeId: ASSIGNEE_ID,
    pmId: PM_ID,
  });

  /** Every viewer archetype × what each actor slot must resolve to for them. */
  const ARCHETYPES: { name: string; ctx: TaskViewerCtx; expects: Record<TransitionActor, boolean> }[] = [
    {
      name: 'the assignee (plain employee)',
      ctx: onTask(ASSIGNEE_ID, 'EMPLOYEE'),
      expects: { ASSIGNEE: true, PROJECT_MANAGER: false, TEAM_LEAD: false },
    },
    {
      name: 'the appointed manager (plain employee)',
      ctx: onTask(PM_ID, 'EMPLOYEE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: false },
    },
    {
      name: 'an unrelated employee',
      ctx: onTask('user-bystander', 'EMPLOYEE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false },
    },
    {
      name: 'HR',
      ctx: onTask('user-hr', 'HR'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: false },
    },
    {
      name: 'a team lead',
      ctx: onTask('user-tl', 'TEAM_LEAD'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: true },
    },
    {
      name: 'finance',
      ctx: onTask('user-fin', 'FINANCE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false },
    },
    {
      name: 'super admin',
      ctx: onTask('user-sa', 'SUPER_ADMIN'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: true },
    },
    {
      // The client has no actor slot at all (2026-07-27: view + request-status
      // only) — every actor must resolve false for them.
      name: 'a client (no approval power left)',
      ctx: onTask('user-client', 'CLIENT'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false },
    },
  ];

  it('resolves every actor slot for every archetype', () => {
    for (const a of ARCHETYPES) {
      for (const actor of Object.keys(a.expects) as TransitionActor[]) {
        expect(canPerform([actor], a.ctx), `${a.name} as ${actor}`).toBe(a.expects[actor]);
      }
    }
  });

  it('walks every transition row: eligibility comes only from its actors list', () => {
    for (const t of TASK_TRANSITIONS) {
      for (const a of ARCHETYPES) {
        const expected = t.actors.some((actor) => a.expects[actor]);
        expect(canPerform(t.actors, a.ctx), `${a.name} on ${t.action} from ${t.from}`).toBe(expected);
      }
    }
  });

  it('a client has zero visible actions on any status', () => {
    const client = onTask('user-client', 'CLIENT');
    for (const status of Object.values(TaskStatus)) {
      expect(visibleTaskActions(status, client), status).toEqual([]);
    }
  });

  it('the reported bug: Acknowledge is only ever offered to the assignee', () => {
    const sa = onTask('user-sa', 'SUPER_ADMIN');
    expect(visibleTaskActions(TaskStatus.ASSIGNED, sa).map((x) => x.action)).not.toContain(
      TaskAction.ACKNOWLEDGE,
    );
    expect(
      visibleTaskActions(TaskStatus.ASSIGNED, onTask(ASSIGNEE_ID, 'EMPLOYEE')).map((x) => x.action),
    ).toEqual([TaskAction.ACKNOWLEDGE]);
  });

  it('appointment is per-project: no manager powers on another project', () => {
    const elsewhere: TaskViewerCtx = {
      meId: PM_ID,
      meRole: 'EMPLOYEE',
      assigneeId: ASSIGNEE_ID,
      pmId: 'someone-else',
    };
    expect(canPerform(['PROJECT_MANAGER'], elsewhere)).toBe(false);
    expect(visibleTaskActions(TaskStatus.SUBMITTED_FOR_REVIEW, elsewhere)).toEqual([]);
  });

  it('an unassigned task never matches ASSIGNEE (null !== null guard)', () => {
    const noAssignee: TaskViewerCtx = { meId: 'user-x', meRole: 'EMPLOYEE', assigneeId: null, pmId: null };
    expect(canPerform(['ASSIGNEE'], noAssignee)).toBe(false);
  });

  it('cancel: manager-only, dead at Closed and Cancelled', () => {
    expect(canCancelTask(TaskStatus.IN_PROGRESS, onTask('user-sa', 'SUPER_ADMIN'))).toBe(true);
    expect(canCancelTask(TaskStatus.IN_PROGRESS, onTask(PM_ID, 'EMPLOYEE'))).toBe(true);
    expect(canCancelTask(TaskStatus.IN_PROGRESS, onTask('user-tl', 'TEAM_LEAD'))).toBe(false);
    expect(canCancelTask(TaskStatus.IN_PROGRESS, onTask(ASSIGNEE_ID, 'EMPLOYEE'))).toBe(false);
    expect(canCancelTask(TaskStatus.CLOSED, onTask('user-sa', 'SUPER_ADMIN'))).toBe(false);
    expect(canCancelTask(TaskStatus.CANCELLED, onTask('user-sa', 'SUPER_ADMIN'))).toBe(false);
  });
});
