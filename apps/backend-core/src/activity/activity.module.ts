import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { LogsController } from './logs.controller.js';
import { PermissionsModule } from '../permissions/permissions.module.js';

@Module({ imports: [PermissionsModule], controllers: [ActivityController, LogsController] })
export class ActivityModule {}
