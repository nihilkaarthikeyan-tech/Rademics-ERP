import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TasksService } from './tasks.service';
import {
  AssignTaskDto,
  ChecklistItemDto,
  CreateCommentDto,
  CreateTaskDto,
  ListTasksQuery,
  TransitionDto,
  UpdateTaskDto,
} from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  // No declared capability: the service resolves projects.view_all vs the SCOPED
  // projects.view_own_team (§3) itself — a single fixed key cannot express "all
  // roles may list, but TL/EMP only see their own projects' tasks".
  @Get()
  list(@Query() query: ListTasksQuery, @CurrentUser() user: AuthUser) {
    return this.tasks.list(query, user);
  }

  // Auth-only: strictly the caller's own assignments (My Work queue), so every
  // internal role may call it — the where-clause IS the authorization.
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.tasks.listMine(user);
  }

  @Post()
  @RequireCapability('tasks.create')
  create(@Body() dto: CreateTaskDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.tasks.create(dto, actor, reqMeta(req));
  }

  // No declared capability: assignees/watchers/creators may open their own task
  // even without projects.view_all — the service enforces that access rule (§3).
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.get(id, user);
  }

  @Patch(':id')
  @RequireCapability('tasks.create')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.tasks.update(id, dto, actor, reqMeta(req));
  }

  @Post(':id/assign')
  @RequireCapability('tasks.assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.tasks.assign(id, dto.assigneeId, actor, reqMeta(req));
  }

  // No declared capability: the §6 state machine authorizes by ACTOR eligibility
  // (assignee / PM / TL / client approver / finance) inside the service — a fixed
  // capability key cannot express that. JwtAuthGuard still requires authentication.
  @Post(':id/transition')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    return this.tasks.transition(id, dto.action, dto.comment, actor, reqMeta(req));
  }

  // ── Comments ──
  @Get(':id/comments')
  @RequireCapability('tasks.comment')
  listComments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.listComments(id, user);
  }

  @Post(':id/comments')
  @RequireCapability('tasks.comment')
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tasks.addComment(id, dto, actor);
  }

  // ── Checklist ──
  @Post(':id/checklist')
  @RequireCapability('tasks.create')
  addChecklistItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChecklistItemDto) {
    return this.tasks.addChecklistItem(id, dto);
  }

  @Post(':id/checklist/:itemId/toggle')
  @RequireCapability('tasks.comment')
  toggleChecklistItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.tasks.toggleChecklistItem(id, itemId);
  }

  // ── Watchers ──
  @Post(':id/watchers')
  @RequireCapability('tasks.comment')
  addWatcher(@Param('id', ParseUUIDPipe) id: string, @Body('userId', ParseUUIDPipe) userId: string) {
    return this.tasks.addWatcher(id, userId);
  }

  @Delete(':id/watchers/:userId')
  @RequireCapability('tasks.comment')
  removeWatcher(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.tasks.removeWatcher(id, userId);
  }
}
