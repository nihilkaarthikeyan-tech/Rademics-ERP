import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { AttendanceComputeService } from './attendance-compute.service';
import { AttendanceHistoryQuery, CheckInDto } from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly compute: AttendanceComputeService,
  ) {}

  // ── Self check-in / out / heartbeat (Spec §5.3) ──
  @Post('check-in')
  @RequireCapability('attendance.check_in_out')
  checkIn(@Body() dto: CheckInDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.attendance.checkIn(user, dto.idempotencyKey, reqMeta(req), dto.source);
  }

  @Post('check-out')
  @RequireCapability('attendance.check_in_out')
  checkOut(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.attendance.checkOut(user, reqMeta(req));
  }

  @Post('heartbeat')
  @RequireCapability('attendance.check_in_out')
  heartbeat(@CurrentUser() user: AuthUser) {
    return this.attendance.heartbeat(user);
  }

  // ── Own status + history (Spec §5.3, §17.1) ──
  @Get('today')
  @RequireCapability('attendance.own.view')
  today(@CurrentUser() user: AuthUser) {
    return this.attendance.today(user);
  }

  @Get('me')
  @RequireCapability('attendance.own.view')
  myHistory(@Query() query: AttendanceHistoryQuery, @CurrentUser() user: AuthUser) {
    return this.attendance.myHistory(user, query);
  }

  // ── Team (SCOPED §3) ──
  @Get('team')
  @RequireScopedCapability('attendance.team.view')
  teamHistory(@Query() query: AttendanceHistoryQuery, @CurrentUser() user: AuthUser) {
    return this.attendance.teamHistory(user, query);
  }

  @Get('team/online')
  @RequireScopedCapability('attendance.team.view')
  teamOnline(@CurrentUser() user: AuthUser) {
    return this.attendance.onlineTeam(user);
  }

  // ── All (HR / Super Admin) ──
  @Get()
  @RequireCapability('attendance.all.view')
  allHistory(@Query() query: AttendanceHistoryQuery) {
    return this.attendance.allHistory(query);
  }

  @Get('online')
  @RequireCapability('attendance.all.view')
  online() {
    return this.attendance.onlineAll();
  }

  // ── Manual nightly recompute (HR / SA) — for a specific date, idempotent ──
  @Post('recompute')
  @RequireCapability('attendance.rules.configure')
  recompute(@Body('date') date?: string) {
    return this.compute.runNightly(date);
  }
}
