import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AiService } from './ai.service';
import { AssignmentSuggestionDto, ChatDto, DailySummaryDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/** The four AI features (Spec §7). All gated by ai.assistant.use; scope + rate limit
 *  enforced in the service. Clients (CLIENT role) are denied by the matrix. */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('daily-summary')
  @RequireCapability('ai.assistant.use')
  dailySummary(@Body() dto: DailySummaryDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.ai.dailySummary(dto.teamId, user, reqMeta(req));
  }

  @Get('completion-forecast/:projectId')
  @RequireCapability('ai.assistant.use')
  forecast(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: AuthUser) {
    return this.ai.completionForecast(projectId, user);
  }

  @Post('assignment-suggestion')
  @RequireCapability('ai.assistant.use')
  suggest(@Body() dto: AssignmentSuggestionDto, @CurrentUser() user: AuthUser) {
    return this.ai.assignmentSuggestion(dto, user);
  }

  @Post('chat')
  @RequireCapability('ai.assistant.use')
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.ai.chat(dto.question, user, reqMeta(req));
  }
}
