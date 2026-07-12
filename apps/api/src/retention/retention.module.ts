import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { RetentionProcessor } from './retention.processor';
import { QUEUE_RETENTION } from './retention.constants';

/** Phase 10 — Data-retention jobs (Spec §4, §10, §25): notification 90-day purge +
 *  monitoring-data 12-month purge, scheduled daily and triggerable on demand. */
@Module({
  imports: [
    SettingsModule, // config-driven retention windows (§4)
    BullModule.registerQueue({ name: QUEUE_RETENTION }),
  ],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionProcessor],
  exports: [RetentionService],
})
export class RetentionModule {}
