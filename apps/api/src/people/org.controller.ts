import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrgService } from './org.service';
import { CreateDepartmentDto, CreateSkillTagDto, CreateTeamDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // ── Departments ──
  @Get('departments')
  @RequireCapability('people.directory.view')
  listDepartments() {
    return this.org.listDepartments();
  }

  @Post('departments')
  @RequireCapability('people.departments.manage')
  createDepartment(@Body() dto: CreateDepartmentDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.org.createDepartment(dto, actor, reqMeta(req));
  }

  // ── Teams ──
  @Get('teams')
  @RequireCapability('people.directory.view')
  listTeams() {
    return this.org.listTeams();
  }

  @Post('teams')
  @RequireCapability('people.departments.manage')
  createTeam(@Body() dto: CreateTeamDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.org.createTeam(dto, actor, reqMeta(req));
  }

  // ── Skill tags ──
  @Get('skills')
  @RequireCapability('people.directory.view')
  listSkills() {
    return this.org.listSkills();
  }

  @Post('skills')
  @RequireCapability('people.departments.manage')
  createSkill(@Body() dto: CreateSkillTagDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.org.createSkill(dto, actor, reqMeta(req));
  }
}
