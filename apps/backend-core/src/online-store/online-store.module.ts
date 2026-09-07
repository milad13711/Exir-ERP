import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { StoreProductsController } from './store-products.controller.js';
import { StoreOrdersController } from './store-orders.controller.js';
import { StoreOrdersService } from './store-orders.service.js';
import { StoreAnalyticsController } from './store-analytics.controller.js';
import { StoreAutomationTriggers } from './store-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule],
  controllers: [StoreProductsController, StoreOrdersController, StoreAnalyticsController],
  providers: [StoreOrdersService, StoreAutomationTriggers],
  exports: [StoreOrdersService],
})
export class OnlineStoreModule {}
