import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksProcessor } from './tasks.processor';
import { QUEUE_TASKS } from './tasks.constants';

/** Phase 4 — Projects & Tasks (Spec §5.4, §6): hierarchy, state machine, comments. */
@Module({
  imports: [
    NotificationsModule, // task events fire notifications (§5.12)
    BullModule.registerQueue({ name: QUEUE_TASKS }), // daily acceptance sweep
  ],
  controllers: [ProjectsController, TasksController],
  providers: [ProjectsService, TasksService, TasksProcessor],
  exports: [TasksService],
})
export class ProjectsModule {}
