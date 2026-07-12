/** Data-retention queue + job names (Spec §4, §10, §25: retention runs on the queue). */
export const QUEUE_RETENTION = 'retention';

/** Daily: hard-delete data past its configured retention window (Spec §25 deletion policy). */
export const RETENTION_JOB_PURGE = 'retention-purge';

/** Stable repeatable-job id so re-registration on boot replaces rather than duplicates. */
export const RETENTION_REPEAT_ID = 'retention-daily';
