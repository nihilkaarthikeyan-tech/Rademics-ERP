import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClientAdminService } from './client-admin.service';
import { CreateClientOrgDto, CreateClientUserDto, GrantAccessDto } from './dto';
import { RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/** Internal-side client administration (Spec §2). portal.users.manage: SA=ALLOW, PM=SCOPED. */
@Controller('client-orgs')
export class ClientAdminController {
  constructor(private readonly admin: ClientAdminService) {}

  @Post()
  @RequireScopedCapability('portal.users.manage')
  createOrg(@Body() dto: CreateClientOrgDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.createOrg(dto, actor, reqMeta(req));
  }

  @Get()
  @RequireScopedCapability('portal.users.manage')
  listOrgs() {
    return this.admin.listOrgs();
  }

  @Post(':orgId/users')
  @RequireScopedCapability('portal.users.manage')
  createUser(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateClientUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.admin.createClientUser(orgId, dto, actor, reqMeta(req));
  }

  @Post(':orgId/deactivate')
  @RequireScopedCapability('portal.users.manage')
  deactivate(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.deactivateOrg(orgId, actor, reqMeta(req));
  }

  @Post('access')
  @RequireScopedCapability('portal.users.manage')
  grantAccess(@Body() dto: GrantAccessDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.admin.grantAccess(dto.projectId, dto, actor, reqMeta(req));
  }
}
