/** Tasks queue + job names (Spec §11: all scheduled work runs on the queue). */
export const QUEUE_TASKS = 'tasks';

/** Daily chase of unaccepted assignments: remind assignee at 24h, tell the manager at 48h. */
export const TASK_JOB_ACCEPT_SWEEP = 'acceptance-sweep';

/** Daily chase (2026-07-27) of client-facing tasks with no client-visible movement in 3+ days. */
export const TASK_JOB_CLIENT_UPDATE_SWEEP = 'client-update-sweep';

/** Hourly deadline watch (2026-07-27, Spec §5.12): warn at ≤24h, alert once missed. */
export const TASK_JOB_DEADLINE_SWEEP = 'deadline-sweep';

/** Stable repeatable-job ids so re-registration on boot replaces rather than duplicates. */
export const TASK_ACCEPT_SWEEP_REPEAT_ID = 'task-acceptance-sweep';
export const TASK_CLIENT_UPDATE_SWEEP_REPEAT_ID = 'task-client-update-sweep';
export const TASK_DEADLINE_SWEEP_REPEAT_ID = 'task-deadline-sweep';
