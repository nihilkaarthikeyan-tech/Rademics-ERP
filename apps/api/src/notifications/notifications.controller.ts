import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SetPreferenceDto } from './dto';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

/**
 * In-app notification inbox + preferences (Spec §5.12). Every authenticated user
 * reads their OWN notifications only — no capability needed beyond authentication.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.id, unread === 'true');
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Post(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.listPreferences(user.id);
  }

  @Post('preferences')
  setPreference(@Body() dto: SetPreferenceDto, @CurrentUser() user: AuthUser) {
    return this.notifications.setPreference(user.id, dto.eventGroup, dto.pref);
  }
}
