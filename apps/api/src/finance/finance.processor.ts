import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InvoicesService } from './invoices.service';
import { FINANCE_JOB_OVERDUE, FINANCE_OVERDUE_REPEAT_ID, QUEUE_FINANCE } from './finance.constants';

/**
 * Scheduled finance work (Spec §5.8, §11): a daily sweep flags past-due unpaid
 * invoices as Overdue. Stable job id → re-registration replaces rather than duplicates.
 */
@Processor(QUEUE_FINANCE)
export class FinanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FinanceProcessor.name);

  constructor(
    private readonly invoices: InvoicesService,
    @InjectQueue(QUEUE_FINANCE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      FINANCE_JOB_OVERDUE,
      {},
      { repeat: { pattern: '20 0 * * *' }, jobId: FINANCE_OVERDUE_REPEAT_ID, removeOnComplete: 14, removeOnFail: 14 },
    );
    this.logger.log('Finance overdue sweep scheduled (00:20 daily)');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== FINANCE_JOB_OVERDUE) return undefined;
    const result = await this.invoices.sweepOverdue();
    if (result.flagged) this.logger.log(`Overdue sweep: ${result.flagged} invoice(s) flagged`);
    return result;
  }
}
