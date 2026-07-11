/** Queue + job names. All long work runs on the queue (Spec §11). */
export const QUEUE_EMAIL = 'email';

export const EMAIL_JOB_SEND = 'send';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
