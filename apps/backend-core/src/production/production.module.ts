import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { BomsController } from './boms.controller.js';
import { WorkCentersController } from './work-centers.controller.js';
import { ProductionOrdersController } from './orders.controller.js';
import { SeasonalAlertService } from './seasonal-alert.service.js';
import { ProductionAutomationTriggers } from './production-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule, AutomationModule],
  controllers: [BomsController, WorkCentersController, ProductionOrdersController],
  providers: [SeasonalAlertService, ProductionAutomationTriggers],
})
export class ProductionModule {}
