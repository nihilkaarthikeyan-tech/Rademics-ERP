import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { ClientAdminService } from './client-admin.service';
import { ClientAdminController } from './client-admin.controller';

/**
 * Phase 6 — Client Portal (Spec §2, §5.5): scoped, read-only progress + one
 * write action ("ask for a status update", 2026-07-27). No approval power.
 */
@Module({
  imports: [
    AuthModule, // invite client users
    FilesModule, // client-visible file listing/download
    NotificationsModule, // "ask for a status update" notifies the assignee + PM
  ],
  controllers: [PortalController, ClientAdminController],
  providers: [PortalService, ClientAdminService],
})
export class PortalModule {}
