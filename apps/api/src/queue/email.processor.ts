import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { QUEUE_EMAIL, type EmailJobData } from './queue.constants';

/** Worker that actually sends queued email (Spec §5.12, §11). */
@Processor(QUEUE_EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    await this.mail.send(job.data);
  }
}
