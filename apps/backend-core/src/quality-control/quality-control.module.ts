import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TestTypesController } from './test-types.controller.js';
import { QualitySamplesController } from './samples.controller.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule],
  controllers: [TestTypesController, QualitySamplesController],
})
export class QualityControlModule {}
