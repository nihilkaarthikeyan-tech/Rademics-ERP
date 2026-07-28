import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';

@Module({
  // AttendanceModule for PresenceService — push 'people:changed' to open directories.
  imports: [AuthModule, NotificationsModule, AttendanceModule],
  controllers: [OrgController, EmployeesController],
  providers: [OrgService, EmployeesService],
})
export class PeopleModule {}
