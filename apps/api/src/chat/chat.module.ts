import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

/** Company chat v1 (2026-07-26): one general room over the presence socket. */
@Module({
  imports: [AttendanceModule], // PresenceService delivers 'chat:message' live
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
