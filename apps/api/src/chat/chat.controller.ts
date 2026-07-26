import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { ChatService } from './chat.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

class PostMessageDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}

class ListQueryDto {
  @IsOptional()
  @IsISO8601()
  before?: string;
}

/** Company chat v1 (2026-07-26): the one general room. Staff only (service-enforced). */
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('messages')
  list(@Query() query: ListQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.list(user, query.before);
  }

  @Post('messages')
  post(@Body() dto: PostMessageDto, @CurrentUser() user: AuthUser) {
    return this.chat.post(user, dto.body);
  }

  @Post('read')
  markRead(@CurrentUser() user: AuthUser) {
    return this.chat.markRead(user);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.chat.unreadCount(user);
  }

  @Get('active')
  activeNow(@CurrentUser() user: AuthUser) {
    return this.chat.activeNow(user);
  }
}
