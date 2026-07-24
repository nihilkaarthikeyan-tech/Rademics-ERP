import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { AttendanceComputeService } from './attendance-compute.service';
import { AttendanceHistoryQuery, CheckInDto, CheckOutDto } from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import { DesktopVersionService } from '../desktop/desktop-version.service';
import type { AuthUser } from '../auth/auth-user';

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly compute: AttendanceComputeService,
    private readonly desktopVersion: DesktopVersionService,
  ) {}

  // ── Self check-in / out / heartbeat (Spec §5.3) ──
  // Check-in (starting a new work day) enforces the desktop minimum version;
  // check-out/heartbeat deliberately don't — never trap an open session.
  @Post('check-in')
  @RequireCapability('attendance.check_in_out')
  async checkIn(@Body() dto: CheckInDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.desktopVersion.assertSupported(req);
    return this.attendance.checkIn(user, dto.idempotencyKey, reqMeta(req), dto.source);
  }

  @Post('check-out')
  @RequireCapability('attendance.check_in_out')
  checkOut(@Body() dto: CheckOutDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.attendance.checkOut(user, reqMeta(req), dto.reconcile ?? false);
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
