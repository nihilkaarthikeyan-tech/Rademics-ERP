import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AttendanceComputeService } from './attendance-compute.service';
import {
  ATTENDANCE_JOB_NIGHTLY,
  ATTENDANCE_NIGHTLY_REPEAT_ID,
  QUEUE_ATTENDANCE,
} from './attendance.constants';

interface NightlyJobData {
  forDate?: string;
}

/**
 * Worker for scheduled attendance work (Spec §5.3, §11). On boot it registers a
 * repeatable nightly job (00:05 in the API's local time) — a stable job id means
 * re-registration replaces rather than duplicates.
 */
@Processor(QUEUE_ATTENDANCE)
export class AttendanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AttendanceProcessor.name);

  constructor(
    private readonly compute: AttendanceComputeService,
    @InjectQueue(QUEUE_ATTENDANCE) private readonly queue: Queue<NightlyJobData>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      ATTENDANCE_JOB_NIGHTLY,
      {},
      {
        repeat: { pattern: '5 0 * * *' }, // 00:05 daily
        jobId: ATTENDANCE_NIGHTLY_REPEAT_ID,
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    );
    this.logger.log('Nightly attendance job scheduled (00:05 daily)');
  }

  async process(job: Job<NightlyJobData>): Promise<unknown> {
    if (job.name !== ATTENDANCE_JOB_NIGHTLY) return undefined;
    return this.compute.runNightly(job.data.forDate);
  }
}
