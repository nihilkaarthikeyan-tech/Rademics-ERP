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

  @Get()
  @RequireCapability('projects.view_all')
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user);
  }

  // Static route declared before ':id' so it is not shadowed by the param route.
  @Get('assignable-users')
  @RequireCapability('tasks.assign')
  assignableUsers() {
    return this.projects.listAssignableUsers();
  }

  @Get(':id')
  @RequireCapability('projects.view_all')
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

  @Get(':id/modules')
  @RequireCapability('projects.view_all')
  modules(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listModules(id);
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
