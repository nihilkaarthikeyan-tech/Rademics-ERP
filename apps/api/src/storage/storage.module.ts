import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ClamavService } from './clamav.service';

/** Object storage + virus scanning (Spec §5.6, §12). Global so any module can attach files. */
@Global()
@Module({
  providers: [StorageService, ClamavService],
  exports: [StorageService, ClamavService],
})
export class StorageModule {}
