import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import type { Request } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
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

  /** Omitted: the company room. */
  @IsOptional()
  @IsUUID()
  roomId?: string;

  /** The message this one replies to (same conversation). */
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

class RenameGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}

class ForwardDto {
  @IsUUID()
  roomId!: string;
}

class ScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @IsISO8601()
  sendAt!: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;
}

class MuteDto {
  @IsBoolean()
  muted!: boolean;
}

class SearchQueryDto {
  @IsString()
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;
}

class ListQueryDto {
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;
}

class RoomQueryDto {
  @IsOptional()
  @IsUUID()
  roomId?: string;
}

class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMaxSize(300)
  @IsUUID('all', { each: true })
  memberIds!: string[];
}

class AddMembersDto {
  @IsArray()
  @ArrayMaxSize(300)
  @IsUUID('all', { each: true })
  memberIds!: string[];
}

class OpenDirectDto {
  @IsUUID()
  userId!: string;
}

class EditMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

class ReactDto {
  // The service whitelists the palette; this only bounds the payload.
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji!: string;
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

/**
 * Company chat with groups and one-to-one conversations. Staff only and every
 * room access rule is service-enforced; `roomId` omitted means the company room.
 */
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** The caller's conversations: company room, their groups, their direct chats. */
  @Get('rooms')
  rooms(@CurrentUser() user: AuthUser) {
    return this.chat.rooms(user);
  }

  /** HR / Super Admin create a group. */
  @Post('rooms')
  createGroup(@Body() dto: CreateGroupDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.createGroup(user, dto.name, dto.memberIds, reqMeta(req));
  }

  @Get('rooms/:id/members')
  roomMembers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.roomMembers(user, id);
  }

  /** HR / Super Admin add people to a group. */
  @Post('rooms/:id/members')
  addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.chat.addMembers(user, id, dto.memberIds, reqMeta(req));
  }

  /** HR / Super Admin take someone out of a group. */
  @Delete('rooms/:id/members/:userId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.chat.removeMember(user, id, memberId, reqMeta(req));
  }

  /** HR / Super Admin rename a group. */
  @Patch('rooms/:id')
  renameGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameGroupDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.chat.renameGroup(user, id, dto.name, reqMeta(req));
  }

  /** HR / Super Admin delete a group (hidden for everyone; records kept). */
  @Delete('rooms/:id')
  archiveGroup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.archiveGroup(user, id, reqMeta(req));
  }

  /** Every file shared in a conversation. */
  @Get('rooms/:id/files')
  roomFiles(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.roomFiles(user, id);
  }

  /** Copy a message into another conversation. */
  @Post('messages/:id/forward')
  forward(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ForwardDto, @CurrentUser() user: AuthUser) {
    return this.chat.forward(user, id, dto.roomId);
  }

  /** Write now, send later. */
  @Post('scheduled')
  schedule(@Body() dto: ScheduleDto, @CurrentUser() user: AuthUser) {
    return this.chat.schedule(user, dto.roomId, dto.body, dto.sendAt);
  }

  /** Your messages waiting to be sent in a conversation. */
  @Get('scheduled')
  listScheduled(@Query() query: RoomQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.listScheduled(user, query.roomId);
  }

  @Delete('scheduled/:id')
  cancelScheduled(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.cancelScheduled(user, id);
  }

  /** HR / Super Admin: space used by chat files, biggest files, the upload limit. */
  @Get('storage')
  storage(@CurrentUser() user: AuthUser) {
    return this.chat.storageSummary(user);
  }

  /** Read receipts: how far each person in the room has read. */
  @Get('rooms/:id/reads')
  reads(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.reads(user, id);
  }

  /** Mute / unmute a conversation for yourself. */
  @Post('rooms/:id/mute')
  mute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MuteDto, @CurrentUser() user: AuthUser) {
    return this.chat.setMuted(user, id, dto.muted);
  }

  /** Search messages and file names across the conversations you can read. */
  @Get('search')
  search(@Query() query: SearchQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.search(user, query.q, query.roomId);
  }

  /** Open (or start) a one-to-one conversation with another staff member. */
  @Post('direct')
  openDirect(@Body() dto: OpenDirectDto, @CurrentUser() user: AuthUser) {
    return this.chat.openDirect(user, dto.userId);
  }

  @Get('messages')
  list(@Query() query: ListQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.list(user, query.roomId, query.before);
  }

  @Post('messages')
  post(@Body() dto: PostMessageDto, @CurrentUser() user: AuthUser) {
    return this.chat.post(user, dto.body ?? '', dto.fileAssetIds ?? [], dto.roomId, dto.replyToId);
  }

  @Post('read')
  markRead(@Query() query: RoomQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.markRead(user, query.roomId);
  }

  /** Which room a message lives in — lets a mention notification open the right chat. */
  @Get('messages/:id/locate')
  locate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.chat.locate(user, id);
  }

  /** Author deletes their own message; HR/Super Admin may delete anyone's (moderation). */
  @Delete('messages/:id')
  removeMessage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.remove(user, id, reqMeta(req));
  }

  /** Author edits their own message within the edit window. */
  @Patch('messages/:id')
  editMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.chat.edit(user, id, dto.body, reqMeta(req));
  }

  /** Toggle an emoji reaction on/off for the caller. */
  @Post('messages/:id/reactions')
  react(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactDto, @CurrentUser() user: AuthUser) {
    return this.chat.react(user, id, dto.emoji);
  }

  /** Pin / unpin an announcement — HR & Super Admin only (service-enforced). */
  @Post('messages/:id/pin')
  pin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.setPinned(user, id, true, reqMeta(req));
  }

  @Delete('messages/:id/pin')
  unpin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.chat.setPinned(user, id, false, reqMeta(req));
  }

  @Get('pinned')
  pinned(@Query() query: RoomQueryDto, @CurrentUser() user: AuthUser) {
    return this.chat.pinned(user, query.roomId);
  }

  /** Staff names for @mention autocomplete. */
  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return this.chat.members(user);
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
