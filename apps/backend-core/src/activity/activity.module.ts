import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { LogsController } from './logs.controller.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { UserActivityController } from './user-activity.controller.js';
import { UserActivityService } from './user-activity.service.js';
import { ActivityTimelineService } from './activity-timeline.service.js';

@Module({
  imports: [PermissionsModule],
  controllers: [ActivityController, LogsController, UserActivityController],
  providers: [UserActivityService, ActivityTimelineService],
})
export class ActivityModule {}
