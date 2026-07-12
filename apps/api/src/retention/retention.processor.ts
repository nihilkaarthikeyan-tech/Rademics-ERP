import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RetentionService } from './retention.service';
import { QUEUE_RETENTION, RETENTION_JOB_PURGE, RETENTION_REPEAT_ID } from './retention.constants';

/**
 * Scheduled data-retention (Spec §4, §10, §25): a daily purge hard-deletes data past
 * its configured window. Stable job id → re-registration on boot replaces rather than
 * duplicates. Runs at 00:40, after the finance overdue sweep (00:20).
 */
@Processor(QUEUE_RETENTION)
export class RetentionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly retention: RetentionService,
    @InjectQueue(QUEUE_RETENTION) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      RETENTION_JOB_PURGE,
      {},
      { repeat: { pattern: '40 0 * * *' }, jobId: RETENTION_REPEAT_ID, removeOnComplete: 14, removeOnFail: 14 },
    );
    this.logger.log('Retention purge scheduled (00:40 daily)');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== RETENTION_JOB_PURGE) return undefined;
    return this.retention.runAll();
  }
}
