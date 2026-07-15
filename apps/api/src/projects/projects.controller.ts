import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService } from './projects.service';
import { CreateModuleDto, CreateProjectDto, UpdateProjectDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // No declared capability: the service resolves projects.view_all vs the SCOPED
  // projects.view_own_team (§3) — TL/EMP see only projects they hold tasks in or PM.
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user);
  }

  // Static route declared before ':id' so it is not shadowed by the param route.
  @Get('assignable-users')
  @RequireCapability('tasks.assign')
  assignableUsers() {
    return this.projects.listAssignableUsers();
  }

  // No declared capability: same §3 scope resolution as list() (service-enforced).
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.projects.get(id, user);
  }

  @Post()
  @RequireCapability('projects.create_edit')
  create(@Body() dto: CreateProjectDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.projects.create(dto, actor, reqMeta(req));
  }

  @Patch(':id')
  @RequireCapability('projects.create_edit')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.projects.update(id, dto, actor, reqMeta(req));
  }

  // No declared capability: same §3 scope resolution as get() (service-enforced).
  @Get(':id/modules')
  modules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.projects.listModules(id, user);
  }

  @Post(':id/modules')
  @RequireCapability('projects.create_edit')
  addModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateModuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.projects.addModule(id, dto, actor);
  }
}
