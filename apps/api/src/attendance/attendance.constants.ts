/** Attendance queue + job names (Spec §11: all long/scheduled work on the queue). */
export const QUEUE_ATTENDANCE = 'attendance';

/** Nightly: auto-close dangling sessions, then compute the day's marks (Spec §5.3). */
export const ATTENDANCE_JOB_NIGHTLY = 'nightly-compute';

/** Repeatable-job id so re-registration on boot replaces rather than duplicates. */
export const ATTENDANCE_NIGHTLY_REPEAT_ID = 'attendance-nightly';

/** Every minute: auto-checkout sessions that have gone silent past the idle threshold. */
export const ATTENDANCE_JOB_IDLE_SWEEP = 'idle-sweep';

/** Repeatable-job id so re-registration on boot replaces rather than duplicates. */
export const ATTENDANCE_IDLE_SWEEP_REPEAT_ID = 'attendance-idle-sweep';

/** Socket.IO room every presence subscriber joins (Spec §5.3 who's-online). */
export const PRESENCE_ROOM = 'presence';

/**
 * Every non-CLIENT socket joins this. Broadcasts go here rather than to the
 * whole namespace: a client account that reached the socket would otherwise
 * receive the internal chat, announcements, and a task:changed feed covering
 * every project in the company. "Only the staff app connects" was an assumption
 * about well-behaved clients, not a control.
 */
export const STAFF_ROOM = 'staff';
