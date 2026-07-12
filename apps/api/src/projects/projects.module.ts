import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';

/** Phase 4 — Projects & Tasks (Spec §5.4, §6): hierarchy, state machine, comments. */
@Module({
  imports: [NotificationsModule], // task events fire notifications (§5.12)
  controllers: [ProjectsController, TasksController],
  providers: [ProjectsService, TasksService],
  exports: [TasksService],
})
export class ProjectsModule {}
