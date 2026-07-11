import { describe, it, expect } from 'vitest';
import { TaskStatus, TaskAction, nextTaskStatus, TASK_TRANSITIONS } from './task-status.js';

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
