import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';

@Module({
  imports: [AuthModule], // EmployeesService reuses AuthService.invite / revocation
  controllers: [OrgController, EmployeesController],
  providers: [OrgService, EmployeesService],
})
export class PeopleModule {}
