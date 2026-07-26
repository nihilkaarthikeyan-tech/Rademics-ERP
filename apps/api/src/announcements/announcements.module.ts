import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';

/** Company notices (2026-07-26): SA/HR post, all staff read + personally pin. */
@Module({
  imports: [
    NotificationsModule, // a new notice notifies every staff member
    AttendanceModule, // PresenceService pushes 'announcement:posted' live
  ],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
