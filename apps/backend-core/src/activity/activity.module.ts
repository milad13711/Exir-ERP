import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { LogsController } from './logs.controller.js';

@Module({ controllers: [ActivityController, LogsController] })
export class ActivityModule {}
