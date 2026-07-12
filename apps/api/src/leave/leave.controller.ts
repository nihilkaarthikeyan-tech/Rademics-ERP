import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { LeaveService } from './leave.service';
import { CreateHolidayDto, CreateLeaveDto, DecideLeaveDto, LeaveCalendarQuery } from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // ── Employee self-service (Spec §5.7) ──
  @Post()
  @RequireCapability('leave.request')
  create(@Body() dto: CreateLeaveDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leave.create(user, dto, reqMeta(req));
  }

  @Get('mine')
  @RequireCapability('leave.request')
  mine(@CurrentUser() user: AuthUser) {
    return this.leave.listMine(user.id);
  }

  @Get('balances')
  @RequireCapability('leave.request')
  balances(@CurrentUser() user: AuthUser) {
    return this.leave.myBalances(user.id);
  }

  @Post(':id/cancel')
  @RequireCapability('leave.request')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leave.cancel(id, user, reqMeta(req));
  }

  // ── Approvals (Spec §5.7) ──
  @Get('pending')
  @RequireScopedCapability('leave.approve_team')
  pending(@CurrentUser() user: AuthUser) {
    return this.leave.listPending(user);
  }

  @Post(':id/approve')
  @RequireScopedCapability('leave.approve_team')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.leave.decide(id, true, dto, user, reqMeta(req));
  }

  @Post(':id/reject')
  @RequireScopedCapability('leave.approve_team')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.leave.decide(id, false, dto, user, reqMeta(req));
  }

  // ── Team calendar (Spec §5.7) ──
  @Get('calendar')
  @RequireScopedCapability('leave.calendar.view')
  calendar(@Query() query: LeaveCalendarQuery, @CurrentUser() user: AuthUser) {
    return this.leave.teamCalendar(user, query);
  }

  // ── Holidays (Spec §5.13) ──
  @Get('holidays')
  @RequireScopedCapability('leave.calendar.view')
  holidays() {
    return this.leave.listHolidays();
  }

  @Post('holidays')
  @RequireCapability('leave.policy.configure')
  addHoliday(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.leave.addHoliday(dto, user, reqMeta(req));
  }

  // ── Admin manual triggers (Spec §5.7 jobs run on schedule; these let HR/SA run
  //    accrual or the escalation sweep on demand and back the verification). ──
  @Post('admin/run-accrual')
  @RequireCapability('leave.policy.configure')
  runAccrual(@Body() body: { forDate?: string }) {
    return this.leave.runAccrual(body?.forDate);
  }

  @Post('admin/run-escalation')
  @RequireCapability('leave.policy.configure')
  runEscalation() {
    return this.leave.runEscalationSweep();
  }
}
