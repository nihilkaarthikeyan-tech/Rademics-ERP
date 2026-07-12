import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RegularizationService } from './regularization.service';
import { CreateRegularizationDto, DecideRegularizationDto } from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('attendance/regularizations')
export class RegularizationController {
  constructor(private readonly regularizations: RegularizationService) {}

  @Post()
  @RequireCapability('attendance.regularization.request')
  create(@Body() dto: CreateRegularizationDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regularizations.create(user, dto, reqMeta(req));
  }

  @Get('mine')
  @RequireCapability('attendance.own.view')
  mine(@CurrentUser() user: AuthUser) {
    return this.regularizations.listMine(user);
  }

  @Get('pending')
  @RequireScopedCapability('attendance.regularization.approve')
  pending(@CurrentUser() user: AuthUser) {
    return this.regularizations.listPending(user);
  }

  @Post(':id/approve')
  @RequireScopedCapability('attendance.regularization.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideRegularizationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.regularizations.decide(id, true, dto, user, reqMeta(req));
  }

  @Post(':id/reject')
  @RequireScopedCapability('attendance.regularization.approve')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideRegularizationDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.regularizations.decide(id, false, dto, user, reqMeta(req));
  }
}
