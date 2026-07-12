import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { LeaveService } from './leave.service';
import {
  LEAVE_ACCRUAL_REPEAT_ID,
  LEAVE_ESCALATION_REPEAT_ID,
  LEAVE_JOB_ACCRUAL,
  LEAVE_JOB_ESCALATION,
  QUEUE_LEAVE,
} from './leave.constants';

interface AccrualJobData {
  forDate?: string;
}

/**
 * Scheduled leave work (Spec §5.7, §11). On boot it registers two repeatable jobs —
 * monthly accrual and the hourly 48h-escalation sweep. Stable job ids mean
 * re-registration on restart replaces rather than duplicates.
 */
@Processor(QUEUE_LEAVE)
export class LeaveProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LeaveProcessor.name);

  constructor(
    private readonly leave: LeaveService,
    @InjectQueue(QUEUE_LEAVE) private readonly queue: Queue<AccrualJobData>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      LEAVE_JOB_ACCRUAL,
      {},
      {
        repeat: { pattern: '10 1 1 * *' }, // 01:10 on the 1st of each month
        jobId: LEAVE_ACCRUAL_REPEAT_ID,
        removeOnComplete: 12,
        removeOnFail: 12,
      },
    );
    await this.queue.add(
      LEAVE_JOB_ESCALATION,
      {},
      {
        repeat: { pattern: '15 * * * *' }, // hourly at :15
        jobId: LEAVE_ESCALATION_REPEAT_ID,
        removeOnComplete: 48,
        removeOnFail: 48,
      },
    );
    this.logger.log('Leave jobs scheduled (accrual monthly, escalation hourly)');
  }

  async process(job: Job<AccrualJobData>): Promise<unknown> {
    if (job.name === LEAVE_JOB_ACCRUAL) return this.leave.runAccrual(job.data.forDate);
    if (job.name === LEAVE_JOB_ESCALATION) return this.leave.runEscalationSweep();
    return undefined;
  }
}
