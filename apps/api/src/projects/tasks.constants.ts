/** Tasks queue + job names (Spec §11: all scheduled work runs on the queue). */
export const QUEUE_TASKS = 'tasks';

/** Daily chase of unaccepted assignments: remind assignee at 24h, tell the manager at 48h. */
export const TASK_JOB_ACCEPT_SWEEP = 'acceptance-sweep';

/** Stable repeatable-job id so re-registration on boot replaces rather than duplicates. */
export const TASK_ACCEPT_SWEEP_REPEAT_ID = 'task-acceptance-sweep';
