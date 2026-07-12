import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { ScanService } from './scan.service';
import { FilesProcessor } from './files.processor';
import { QUEUE_FILES } from './files.constants';

/** Phase 5 — Files (Spec §5.6): presigned upload/download, versioning, virus scan. */
@Module({
  imports: [
    SettingsModule, // file-size / blocked-ext / presigned-lifetime rules (§4)
    NotificationsModule, // quarantine notifications (§5.6)
    BullModule.registerQueue({ name: QUEUE_FILES }),
  ],
  controllers: [FilesController],
  providers: [FilesService, ScanService, FilesProcessor],
  exports: [FilesService], // reused by the client portal (Spec §5.5)
})
export class FilesModule {}
