import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { AttendanceService } from './attendance.service';
import { AttendanceComputeService } from './attendance-compute.service';
import { AttendanceController } from './attendance.controller';
import { RegularizationService } from './regularization.service';
import { RegularizationController } from './regularization.controller';
import { AttendanceProcessor } from './attendance.processor';
import { PresenceService } from './presence.service';
import { PresenceGateway } from './presence.gateway';
import { QUEUE_ATTENDANCE } from './attendance.constants';

/** Phase 3 — Attendance (Spec §5.3): sessions, idle, nightly rules, regularization,
 *  and the Socket.IO presence layer. */
@Module({
  imports: [
    AuthModule, // JwtModule (gateway handshake auth) + AuthService
    SettingsModule, // business-rule reads (Spec §4)
    BullModule.registerQueue({ name: QUEUE_ATTENDANCE }),
  ],
  controllers: [AttendanceController, RegularizationController],
  providers: [
    AttendanceService,
    AttendanceComputeService,
    RegularizationService,
    AttendanceProcessor,
    PresenceService,
    PresenceGateway,
  ],
  exports: [AttendanceService, PresenceService], // PresenceService reused for real-time notifications (§5.12)
})
export class AttendanceModule {}
