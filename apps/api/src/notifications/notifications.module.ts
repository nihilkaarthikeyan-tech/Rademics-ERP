import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * Notifications core (Spec §5.12). Imports AttendanceModule for the shared presence
 * gateway (real-time delivery) — a dedicated RealtimeModule can extract that later.
 */
@Module({
  imports: [AttendanceModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
