import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsString, Length } from 'class-validator';
import { AnnouncementsService } from './announcements.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

class CreateAnnouncementDto {
  @IsString()
  @Length(3, 150)
  title!: string;

  @IsString()
  @Length(1, 5000)
  body!: string;
}

class SetPinDto {
  @IsBoolean()
  pinned!: boolean;
}

/** Company notices (2026-07-26). Role rules live in the service:
 *  SA/HR write and delete; every staff member reads and personally pins. */
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

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.announcements.remove(id, user);
  }
}
