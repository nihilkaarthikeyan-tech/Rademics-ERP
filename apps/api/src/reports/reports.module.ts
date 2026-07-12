import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

/** Phase 9 — Reports & Capacity (Spec §5.9, §5.11, §21): attendance, productivity,
 *  project-status reports with CSV/PDF exports, plus the capacity view. */
@Module({
  imports: [SettingsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
