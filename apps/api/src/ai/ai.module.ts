import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AiGatewayService } from './ai-gateway.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

/** Phase 9 — AI (Spec §7): provider-agnostic gateway + the four scoped features. */
@Module({
  imports: [SettingsModule, AttendanceModule], // per-feature provider/model + daily limit (§4, §23); attendance for the chat assistant's "my attendance" intent
  controllers: [AiController],
  providers: [AiGatewayService, AiService],
  exports: [AiService, AiGatewayService],
})
export class AiModule {}
