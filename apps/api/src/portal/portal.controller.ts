import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PortalService } from './portal.service';
import { ApproveDto, RequestRevisionDto } from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/**
 * Client-facing portal API (Spec §5.5). Client-only capabilities; every response is
 * scoped in PortalService. Internal roles have these capabilities DENIED, so they
 * cannot reach the portal surface at all.
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

  @Get('deliverables')
  @RequireCapability('portal.progress.view')
  deliverables(@CurrentUser() user: AuthUser) {
    return this.portal.listDeliverables(user);
  }

  @Get('invoices')
  @RequireCapability('portal.invoices.view')
  invoices(@CurrentUser() user: AuthUser) {
    return this.portal.listInvoices(user);
  }

  @Post('deliverables/:id/approve')
  @RequireScopedCapability('portal.deliverable.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.portal.approve(id, dto.comment, user, reqMeta(req));
  }

  @Post('deliverables/:id/request-revision')
  @RequireScopedCapability('portal.deliverable.approve')
  requestRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestRevisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.portal.requestRevision(id, dto.comment, user, reqMeta(req));
  }

  @Get('tasks/:id/files')
  @RequireCapability('portal.files.download')
  files(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.listFiles(id, user);
  }

  @Get('files/versions/:id/download')
  @RequireCapability('portal.files.download')
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.download(id, user);
  }
}
