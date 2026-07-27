import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClientAdminService } from './client-admin.service';
import { CreateClientOrgDto, CreateClientUserDto, GrantAccessDto, OnboardClientDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/** Internal-side client administration (Spec §2). portal.users.manage: SUPER_ADMIN only. */
@Controller('client-orgs')
export class ClientAdminController {
  constructor(private readonly admin: ClientAdminService) {}

  @Post()
  @RequireCapability('portal.users.manage')
  createOrg(@Body() dto: CreateClientOrgDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.createOrg(dto, actor, reqMeta(req));
  }

  @Get()
  @RequireCapability('portal.users.manage')
  listOrgs() {
    return this.admin.listOrgs();
  }

  /**
   * The clients this staff member works for, with what needs answering.
   *
   * Auth-only rather than behind portal.users.manage: that capability is
   * Super-Admin-only and this is deliberately for everyone else. The scoping
   * is per-caller inside the service, and no client identity is returned.
   */
  @Get('mine')
  myClients(@CurrentUser() user: AuthUser) {
    return this.admin.myClients(user);
  }

  /** Projects still free to hand to a client — what the onboarding form lists. */
  @Get('assignable-projects')
  @RequireCapability('portal.users.manage')
  assignableProjects() {
    return this.admin.assignableProjects();
  }

  /** What a typed client ID + project codes actually resolve to, live. */
  @Get('verify-pairing')
  @RequireCapability('portal.users.manage')
  verifyPairing(@Query('client') client?: string, @Query('projects') projects?: string) {
    const clientNumber = Number(client);
    const projectNumbers = (projects ?? '')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
    return this.admin.verifyPairing(
      Number.isInteger(clientNumber) && clientNumber > 0 ? clientNumber : null,
      projectNumbers,
    );
  }

  /**
   * Resolve typed project codes to names. Read-only and behind the same
   * capability as the write it precedes.
   */
  @Get('lookup-projects')
  @RequireCapability('portal.users.manage')
  lookupProjects(@Query('numbers') numbers?: string) {
    const parsed = (numbers ?? '')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (parsed.length === 0) return [];
    return this.admin.lookupProjects(parsed.slice(0, 50));
  }

  /** Create a client and grant their projects in one step (2026-07-27). */
  @Post('onboard')
  @RequireCapability('portal.users.manage')
  onboard(@Body() dto: OnboardClientDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.onboardClient(dto, actor, reqMeta(req));
  }

  @Post(':orgId/users')
  @RequireCapability('portal.users.manage')
  createUser(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateClientUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.admin.createClientUser(orgId, dto, actor, reqMeta(req));
  }

  @Post(':orgId/deactivate')
  @RequireCapability('portal.users.manage')
  deactivate(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.deactivateOrg(orgId, actor, reqMeta(req));
  }

  @Post('access')
  @RequireCapability('portal.users.manage')
  grantAccess(@Body() dto: GrantAccessDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.grantAccess(dto.projectId, dto, actor, reqMeta(req));
  }
}
