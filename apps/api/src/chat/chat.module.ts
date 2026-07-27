import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

/** Company chat v1 (2026-07-26): one general room over the presence socket. */
@Module({
  imports: [
    AttendanceModule, // PresenceService delivers 'chat:message' live
    FilesModule, // attachments reuse the §5.6 presigned + ClamAV pipeline
    NotificationsModule, // @mentions land in the bell even when chat is closed
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
