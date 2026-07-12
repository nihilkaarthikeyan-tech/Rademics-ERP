import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';

@Module({
  imports: [AuthModule, NotificationsModule], // invite/revocation + deactivation task-reassignment notify (§25)
  controllers: [OrgController, EmployeesController],
  providers: [OrgService, EmployeesService],
})
export class PeopleModule {}
