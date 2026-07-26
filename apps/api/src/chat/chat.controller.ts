import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import type { Request } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ChatService } from './chat.service';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

class PostMessageDto {
  // Optional: a message may be attachments only (the service rejects "neither").
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  fileAssetIds?: string[];
}

class ListQueryDto {
  @IsOptional()
  @IsISO8601()
  before?: string;
}

class DownloadQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  inline?: boolean;
}

class InitAttachmentDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1024 * 1024 * 1024)
  sizeBytes?: number;
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
    return this.chat.post(user, dto.body ?? '', dto.fileAssetIds ?? []);
  }

  @Post('read')
  markRead(@CurrentUser() user: AuthUser) {
    return this.chat.markRead(user);
  }

  /** Author deletes their own message; HR/Super Admin may delete anyone's (moderation). */
  @Delete('messages/:id')
  removeMessage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.remove(user, id, reqMeta(req));
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.chat.unreadCount(user);
  }

  @Get('active')
  activeNow(@CurrentUser() user: AuthUser) {
    return this.chat.activeNow(user);
  }

  // ── Attachments: init → PUT to storage → finalize → (scan) → download ──
  //
  // Deliberately NOT the /files routes: those require files.upload, which
  // Finance does not hold — yet everyone must be able to open what was shared
  // in the company room. Scope is narrowed instead: chat files only.

  @Post('attachments/init')
  initAttachment(@Body() dto: InitAttachmentDto, @CurrentUser() user: AuthUser) {
    return this.chat.initAttachment(user, dto);
  }

  @Post('attachments/:versionId/finalize')
  finalizeAttachment(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.chat.finalizeAttachment(user, versionId, reqMeta(req));
  }

  @Get('attachments/:versionId/status')
  attachmentStatus(@Param('versionId', ParseUUIDPipe) versionId: string, @CurrentUser() user: AuthUser) {
    return this.chat.attachmentStatus(user, versionId);
  }

  @Get('attachments/:versionId/download')
  downloadAttachment(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query() query: DownloadQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chat.downloadAttachment(user, versionId, query.inline ?? false);
  }
}
