import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, ListEmployeesQuery, SetSalaryDto, UpdateEmployeeDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequireCapability('people.directory.view')
  list(@Query() query: ListEmployeesQuery) {
    return this.employees.list(query);
  }

  @Get(':id')
  @RequireCapability('people.directory.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.employees.get(id, user);
  }

  @Post()
  @RequireCapability('people.employee.create_edit')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.employees.create(dto, actor, reqMeta(req));
  }

  @Patch(':id')
  @RequireCapability('people.employee.create_edit')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.employees.update(id, dto, actor, reqMeta(req));
  }

  @Post(':id/deactivate')
  @RequireCapability('people.employee.deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.employees.deactivate(id, actor, reqMeta(req));
  }

  @Put(':id/salary')
  @RequireCapability('people.salary.view_edit')
  setSalary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSalaryDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.employees.setSalary(id, dto.salary, actor, reqMeta(req));
  }
}
