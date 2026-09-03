import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BomsController } from './boms.controller.js';
import { WorkCentersController } from './work-centers.controller.js';
import { ProductionOrdersController } from './orders.controller.js';
import { SeasonalAlertService } from './seasonal-alert.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule],
  controllers: [BomsController, WorkCentersController, ProductionOrdersController],
  providers: [SeasonalAlertService],
})
export class ProductionModule {}
