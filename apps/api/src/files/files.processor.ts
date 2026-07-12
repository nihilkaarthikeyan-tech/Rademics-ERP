import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ScanService } from './scan.service';
import {
  FILE_CLEANUP_REPEAT_ID,
  FILE_JOB_CLEANUP,
  FILE_JOB_SCAN,
  QUEUE_FILES,
  type ScanJobData,
} from './files.constants';

/** Worker for file scanning + daily orphan cleanup (Spec §5.6, §25, §11). */
@Processor(QUEUE_FILES)
export class FilesProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FilesProcessor.name);

  constructor(
    private readonly scan: ScanService,
    @InjectQueue(QUEUE_FILES) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      FILE_JOB_CLEANUP,
      {},
      { repeat: { pattern: '15 0 * * *' }, jobId: FILE_CLEANUP_REPEAT_ID, removeOnComplete: 20, removeOnFail: 20 },
    );
    this.logger.log('Daily orphan-file cleanup scheduled (00:15)');
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === FILE_JOB_SCAN) {
      await this.scan.scan((job.data as ScanJobData).versionId);
      return { scanned: true };
    }
    if (job.name === FILE_JOB_CLEANUP) {
      return { cleaned: await this.scan.cleanupOrphans() };
    }
    return undefined;
  }
}
