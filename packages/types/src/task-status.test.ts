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
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.ASSIGN, { clientFacing: false })).toBe(
      TaskStatus.ASSIGNED,
    );
    expect(nextTaskStatus(TaskStatus.ASSIGNED, TaskAction.ACKNOWLEDGE, { clientFacing: false })).toBe(
      TaskStatus.ACKNOWLEDGED,
    );
    expect(nextTaskStatus(TaskStatus.ACKNOWLEDGED, TaskAction.START_WORK, { clientFacing: false })).toBe(
      TaskStatus.IN_PROGRESS,
    );
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.SUBMIT, { clientFacing: false })).toBe(
      TaskStatus.SUBMITTED_FOR_REVIEW,
    );
  });

  it('Approve branches on client-facing (§6)', () => {
    expect(
      nextTaskStatus(TaskStatus.SUBMITTED_FOR_REVIEW, TaskAction.APPROVE_REVIEW, { clientFacing: true }),
    ).toBe(TaskStatus.CLIENT_REVIEW);
    expect(
      nextTaskStatus(TaskStatus.SUBMITTED_FOR_REVIEW, TaskAction.APPROVE_REVIEW, { clientFacing: false }),
    ).toBe(TaskStatus.COMPLETED);
  });

  it('client review can approve or request revision', () => {
    expect(nextTaskStatus(TaskStatus.CLIENT_REVIEW, TaskAction.CLIENT_APPROVE, { clientFacing: true })).toBe(
      TaskStatus.COMPLETED,
    );
    expect(
      nextTaskStatus(TaskStatus.CLIENT_REVIEW, TaskAction.CLIENT_REQUEST_REVISION, { clientFacing: true }),
    ).toBe(TaskStatus.IN_PROGRESS);
  });

  it('Cancel is legal from any status except Closed (§6)', () => {
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.CANCEL, { clientFacing: false })).toBe(
      TaskStatus.CANCELLED,
    );
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.CANCEL, { clientFacing: false })).toBe(
      TaskStatus.CANCELLED,
    );
    expect(nextTaskStatus(TaskStatus.CLOSED, TaskAction.CANCEL, { clientFacing: false })).toBeNull();
  });

  it('rejects illegal transitions (must be rejected by the API — §6, §13)', () => {
    // Cannot go straight from Draft to In Progress.
    expect(nextTaskStatus(TaskStatus.DRAFT, TaskAction.START_WORK, { clientFacing: false })).toBeNull();
    // Cannot submit something that is only Assigned.
    expect(nextTaskStatus(TaskStatus.ASSIGNED, TaskAction.SUBMIT, { clientFacing: false })).toBeNull();
    // Cannot invoice something still in progress.
    expect(nextTaskStatus(TaskStatus.IN_PROGRESS, TaskAction.MARK_INVOICED, { clientFacing: false })).toBeNull();
  });

  it('mandatory-comment actions are flagged (§6)', () => {
    const sendBack = TASK_TRANSITIONS.find((t) => t.action === TaskAction.SEND_BACK);
    const revision = TASK_TRANSITIONS.find((t) => t.action === TaskAction.CLIENT_REQUEST_REVISION);
    expect(sendBack?.requiresComment).toBe(true);
    expect(revision?.requiresComment).toBe(true);
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
      expects: { ASSIGNEE: true, PROJECT_MANAGER: false, TEAM_LEAD: false, FINANCE: false, CLIENT_APPROVER: false },
    },
    {
      name: 'the appointed manager (plain employee)',
      ctx: onTask(PM_ID, 'EMPLOYEE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: false, FINANCE: false, CLIENT_APPROVER: false },
    },
    {
      name: 'an unrelated employee',
      ctx: onTask('user-bystander', 'EMPLOYEE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false, FINANCE: false, CLIENT_APPROVER: false },
    },
    {
      name: 'HR',
      ctx: onTask('user-hr', 'HR'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: false, FINANCE: false, CLIENT_APPROVER: false },
    },
    {
      name: 'a team lead',
      ctx: onTask('user-tl', 'TEAM_LEAD'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: true, FINANCE: false, CLIENT_APPROVER: false },
    },
    {
      name: 'finance',
      ctx: onTask('user-fin', 'FINANCE'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false, FINANCE: true, CLIENT_APPROVER: false },
    },
    {
      name: 'super admin',
      ctx: onTask('user-sa', 'SUPER_ADMIN'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: true, TEAM_LEAD: true, FINANCE: true, CLIENT_APPROVER: false },
    },
    {
      name: 'a client (staff app never grants client actions)',
      ctx: onTask('user-client', 'CLIENT'),
      expects: { ASSIGNEE: false, PROJECT_MANAGER: false, TEAM_LEAD: false, FINANCE: false, CLIENT_APPROVER: false },
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

  it('client-review offers nothing to any internal viewer', () => {
    for (const a of ARCHETYPES) {
      expect(visibleTaskActions(TaskStatus.CLIENT_REVIEW, a.ctx), a.name).toEqual([]);
    }
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
