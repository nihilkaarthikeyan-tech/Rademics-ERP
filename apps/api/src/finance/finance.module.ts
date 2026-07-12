import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { ExpensesService } from './expenses.service';
import { PnlService } from './pnl.service';
import { PayrollService } from './payroll.service';
import { FinanceController } from './finance.controller';
import { FinanceProcessor } from './finance.processor';
import { QUEUE_FINANCE } from './finance.constants';

/** Phase 8 — Finance (Spec §5.8, §21): invoices + PDF + payments, expenses, P&L per
 *  vertical, and the payroll CSV export with month lock/unlock. */
@Module({
  imports: [
    SettingsModule, // finance config: GST, terms, rates, branding (§4, §23)
    NotificationsModule, // invoice paid/sent notifications (§5.12)
    BullModule.registerQueue({ name: QUEUE_FINANCE }),
  ],
  controllers: [InvoicesController, FinanceController],
  providers: [InvoicesService, ExpensesService, PnlService, PayrollService, FinanceProcessor],
  exports: [InvoicesService, PayrollService],
})
export class FinanceModule {}
