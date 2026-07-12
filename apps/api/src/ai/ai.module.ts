import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AiGatewayService } from './ai-gateway.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

/** Phase 9 — AI (Spec §7): provider-agnostic gateway + the four scoped features. */
@Module({
  imports: [SettingsModule], // per-feature provider/model + daily limit (§4, §23)
  controllers: [AiController],
  providers: [AiGatewayService, AiService],
  exports: [AiService, AiGatewayService],
})
export class AiModule {}
