import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { TasksController } from './tasks.controller.js';

@Module({ imports: [WebhooksModule, PermissionsModule, ModuleGuardModule], controllers: [TasksController] })
export class TasksModule {}
