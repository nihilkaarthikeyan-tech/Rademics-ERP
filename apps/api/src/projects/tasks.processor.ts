import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { TasksService } from './tasks.service';
import {
  QUEUE_TASKS,
  TASK_ACCEPT_SWEEP_REPEAT_ID,
  TASK_CLIENT_UPDATE_SWEEP_REPEAT_ID,
  TASK_JOB_ACCEPT_SWEEP,
  TASK_JOB_CLIENT_UPDATE_SWEEP,
} from './tasks.constants';

/**
 * Scheduled task work. Two repeatable jobs: the morning acceptance sweep — a
 * task nobody accepts stalls the whole §6 chain, so at 09:00 every stale
 * handoff nudges its assignee (and, past 48h, the project's manager) — and
 * the client-update sweep (2026-07-27), which chases client-facing tasks the
 * client hasn't seen movement on in 3+ days. Stable job ids mean
 * re-registration on restart replaces, not duplicates.
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
    await this.queue.add(
      TASK_JOB_CLIENT_UPDATE_SWEEP,
      {},
      {
        repeat: { pattern: '15 9 * * *' }, // just after the acceptance sweep
        jobId: TASK_CLIENT_UPDATE_SWEEP_REPEAT_ID,
        removeOnComplete: 14,
        removeOnFail: 14,
      },
    );
    this.logger.log('Task jobs scheduled (acceptance sweep 09:00, client-update sweep 09:15)');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === TASK_JOB_ACCEPT_SWEEP) return this.tasks.runAcceptanceSweep();
    if (job.name === TASK_JOB_CLIENT_UPDATE_SWEEP) return this.tasks.runClientUpdateSweep();
    return undefined;
  }
}
