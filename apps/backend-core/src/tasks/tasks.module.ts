import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TasksCronService } from './tasks-cron.service.js';
import { TasksDeliveryHandler } from './tasks-delivery.handler.js';

@Module({
  imports: [WebhooksModule, PermissionsModule, ModuleGuardModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService, TasksCronService, TasksDeliveryHandler],
  exports: [TasksService],
})
export class TasksModule {}
