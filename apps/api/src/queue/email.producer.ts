import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_JOB_SEND, QUEUE_EMAIL, type EmailJobData } from './queue.constants';

/**
 * Enqueues email so the HTTP request never blocks on SMTP (Spec §11).
 * Failed sends retry 3 times with backoff, then land in the DLQ / logs (Spec §5.12).
 */
@Injectable()
export class EmailProducer {
  constructor(@InjectQueue(QUEUE_EMAIL) private readonly queue: Queue<EmailJobData>) {}

  async enqueue(data: EmailJobData): Promise<void> {
    await this.queue.add(EMAIL_JOB_SEND, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
