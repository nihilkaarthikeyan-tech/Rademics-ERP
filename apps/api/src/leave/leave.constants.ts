/** Leave queue + job names (Spec §11: all long/scheduled work runs on the queue). */
export const QUEUE_LEAVE = 'leave';

/** Monthly accrual (Spec §5.7): credit each active internal user their per-type accrual. */
export const LEAVE_JOB_ACCRUAL = 'monthly-accrual';

/** 48h auto-escalation sweep (Spec §5.7): bump unactioned requests up one level. */
export const LEAVE_JOB_ESCALATION = 'escalation-sweep';

/** Stable repeatable-job ids so re-registration on boot replaces rather than duplicates. */
export const LEAVE_ACCRUAL_REPEAT_ID = 'leave-accrual';
export const LEAVE_ESCALATION_REPEAT_ID = 'leave-escalation';
