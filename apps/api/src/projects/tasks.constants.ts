/** Tasks queue + job names (Spec §11: all scheduled work runs on the queue). */
export const QUEUE_TASKS = 'tasks';

/** Daily chase of unaccepted assignments: remind assignee at 24h, tell the manager at 48h. */
export const TASK_JOB_ACCEPT_SWEEP = 'acceptance-sweep';

/** Daily chase (2026-07-27) of client-facing tasks with no client-visible movement in 3+ days. */
export const TASK_JOB_CLIENT_UPDATE_SWEEP = 'client-update-sweep';

/** Stable repeatable-job ids so re-registration on boot replaces rather than duplicates. */
export const TASK_ACCEPT_SWEEP_REPEAT_ID = 'task-acceptance-sweep';
export const TASK_CLIENT_UPDATE_SWEEP_REPEAT_ID = 'task-client-update-sweep';
