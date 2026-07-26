import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { AnnouncementsService } from './announcements.service';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

class CreateAnnouncementDto {
  @IsString()
  @Length(3, 150)
  title!: string;

  @IsString()
  @Length(1, 5000)
  body!: string;

  /** HR/SA may flag a notice as critical — the reader must explicitly acknowledge it. */
  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;
}

class SetPinDto {
  @IsBoolean()
  pinned!: boolean;
}

/** Company notices (2026-07-26). Role rules live in the service:
 *  SA/HR write and delete; every staff member reads, pins, and acknowledges. */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.announcements.list(user);
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: AuthUser) {
    return this.announcements.create(dto, user);
  }

  @Post(':id/pin')
  setPin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPinDto, @CurrentUser() user: AuthUser) {
    return this.announcements.setPin(id, user, dto.pinned);
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.announcements.acknowledge(id, user);
  }

  /** HR/SA only: who still hasn't acknowledged a critical notice, to nudge directly. */
  @Get(':id/pending')
  pending(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.announcements.pendingAcknowledgers(id, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.announcements.remove(id, user, reqMeta(req));
  }
}
