import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import { UpdateBusinessRulesDto, UpdateRolePermissionDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('business-rules')
  @RequireCapability('admin.settings.manage')
  getBusinessRules() {
    return this.settings.getBusinessRules();
  }

  @Put('business-rules')
  @RequireCapability('admin.settings.manage')
  updateBusinessRules(
    @Body() dto: UpdateBusinessRulesDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.settings.updateBusinessRules(dto.patch, actor, reqMeta(req));
  }

  @Get('role-permissions')
  @RequireCapability('admin.settings.manage')
  getRolePermissions() {
    return this.settings.getRolePermissions();
  }

  @Put('role-permissions')
  @RequireCapability('admin.settings.manage')
  updateRolePermission(
    @Body() dto: UpdateRolePermissionDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.settings.updateRolePermission(
      dto.role,
      dto.capabilityKey,
      dto.grant,
      actor,
      reqMeta(req),
    );
  }
}
