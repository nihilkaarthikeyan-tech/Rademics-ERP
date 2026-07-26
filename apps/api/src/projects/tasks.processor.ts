import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { TasksService } from './tasks.service';
import { QUEUE_TASKS, TASK_ACCEPT_SWEEP_REPEAT_ID, TASK_JOB_ACCEPT_SWEEP } from './tasks.constants';

/**
 * Scheduled task work. One repeatable job: the morning acceptance sweep —
 * a task nobody accepts stalls the whole §6 chain, so at 09:00 every stale
 * handoff nudges its assignee (and, past 48h, the project's manager).
 * Stable job id means re-registration on restart replaces, not duplicates.
 */
@Processor(QUEUE_TASKS)
export class TasksProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TasksProcessor.name);

  constructor(
    private readonly tasks: TasksService,
    @InjectQueue(QUEUE_TASKS) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      TASK_JOB_ACCEPT_SWEEP,
      {},
      {
        repeat: { pattern: '0 9 * * *' }, // daily 09:00 — the start-of-day nudge
        jobId: TASK_ACCEPT_SWEEP_REPEAT_ID,
        removeOnComplete: 14,
        removeOnFail: 14,
      },
    );
    this.logger.log('Task jobs scheduled (acceptance sweep daily 09:00)');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === TASK_JOB_ACCEPT_SWEEP) return this.tasks.runAcceptanceSweep();
    return undefined;
  }
}
