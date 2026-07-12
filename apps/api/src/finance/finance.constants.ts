/** Finance queue + job names (Spec §11: scheduled work runs on the queue). */
export const QUEUE_FINANCE = 'finance';

/** Daily: flag past-due unpaid invoices as Overdue (Spec §5.8). */
export const FINANCE_JOB_OVERDUE = 'overdue-sweep';

/** Stable repeatable-job id so re-registration on boot replaces rather than duplicates. */
export const FINANCE_OVERDUE_REPEAT_ID = 'finance-overdue';
