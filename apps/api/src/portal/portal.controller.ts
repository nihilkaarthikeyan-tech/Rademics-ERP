import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PortalService } from './portal.service';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

/**
 * Client-facing portal API (Spec §5.5). Client-only capabilities; every response is
 * scoped in PortalService. Internal roles have these capabilities DENIED, so they
 * cannot reach the portal surface at all.
 *
 * 2026-07-27: view + request-status only — no approve/request-revision, no
 * invoices. The client's write surface is exactly one action.
 */
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('projects')
  @RequireCapability('portal.progress.view')
  projects(@CurrentUser() user: AuthUser) {
    return this.portal.listProjects(user);
  }

  @Get('projects/:id')
  @RequireCapability('portal.progress.view')
  project(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.getProject(id, user);
  }

  @Get('tasks/:id/files')
  @RequireCapability('portal.files.download')
  files(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.listFiles(id, user);
  }

  /** Progress feed: client-visible comments staff posted on this task. */
  @Get('tasks/:id/updates')
  @RequireCapability('portal.progress.view')
  updates(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.listUpdates(id, user);
  }

  /** "Ask for a status update" — the client's only write action. */
  @Post('tasks/:id/request-status')
  @RequireCapability('portal.progress.view')
  requestStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.requestStatus(id, user);
  }

  @Get('files/versions/:id/download')
  @RequireCapability('portal.files.download')
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.download(id, user);
  }
}
