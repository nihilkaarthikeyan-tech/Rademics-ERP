import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';
import { LeaveProcessor } from './leave.processor';
import { QUEUE_LEAVE } from './leave.constants';

/** Phase 7 — Leave (Spec §5.7): balances/accrual, routed approval chain with 48h
 *  escalation, team calendar with overlap warnings, excess→unpaid, holiday refund. */
@Module({
  imports: [
    SettingsModule, // leave quotas / working days from Admin Settings (§4)
    NotificationsModule, // request / decision / escalation notifications (§5.12)
    BullModule.registerQueue({ name: QUEUE_LEAVE }),
  ],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveProcessor],
  exports: [LeaveService], // Phase 8 payroll export reads approved leave + unpaid days
})
export class LeaveModule {}
