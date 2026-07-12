import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FilesService } from './files.service';
import { InitUploadDto, SetVisibilityDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  // Begin an upload → returns a presigned PUT URL (browser uploads directly, §5.6).
  @Post('init')
  @RequireCapability('files.upload')
  init(@Body() dto: InitUploadDto, @CurrentUser() actor: AuthUser) {
    return this.files.initUpload(dto, actor);
  }

  // Confirm the object landed → enqueue the virus scan.
  @Post('versions/:id/finalize')
  @RequireCapability('files.upload')
  finalize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.files.finalize(id, actor, reqMeta(req));
  }

  @Get('versions/:id/status')
  @RequireCapability('files.upload')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.scanStatus(id);
  }

  @Get('versions/:id/download')
  @RequireCapability('files.upload')
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.files.download(id, user);
  }

  @Put('versions/:id/visibility')
  @RequireCapability('files.mark_client_visible')
  setVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetVisibilityDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.files.setVisibility(id, dto.visibility, actor, reqMeta(req));
  }

  @Delete('versions/:id')
  @RequireCapability('files.delete_version')
  deleteVersion(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.files.deleteVersion(id, actor, reqMeta(req));
  }

  // List a task's files (scoped for clients).
  @Get()
  @RequireCapability('files.upload')
  listForTask(@Query('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() user: AuthUser) {
    return this.files.listForTask(taskId, user);
  }
}
