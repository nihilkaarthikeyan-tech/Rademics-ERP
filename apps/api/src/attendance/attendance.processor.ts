import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AttendanceComputeService } from './attendance-compute.service';
import {
  ATTENDANCE_IDLE_SWEEP_REPEAT_ID,
  ATTENDANCE_JOB_IDLE_SWEEP,
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

    // Idle no longer force-checks-out (Spec §5.3 revised): a silent session stays open
    // and its idle time is tracked instead of ending the session — people working in
    // other apps (VS Code, etc.) must not be signed out. Remove the old 1-minute
    // idle-checkout sweep a previous deploy may have registered.
    try {
      await this.queue.removeRepeatable(ATTENDANCE_JOB_IDLE_SWEEP, { every: 60_000 }, ATTENDANCE_IDLE_SWEEP_REPEAT_ID);
      this.logger.log('Removed obsolete idle-checkout sweep');
    } catch {
      // Best-effort: nothing to remove if it was never registered.
    }
  }

  async process(job: Job<NightlyJobData>): Promise<unknown> {
    if (job.name === ATTENDANCE_JOB_NIGHTLY) return this.compute.runNightly(job.data.forDate);
    return undefined;
  }
}
