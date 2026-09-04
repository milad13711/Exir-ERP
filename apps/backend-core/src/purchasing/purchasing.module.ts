import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { WarehouseModule } from '../warehouse/warehouse.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SuppliersController } from './suppliers.controller.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseReturnsController } from './purchase-returns.controller.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { PurchasingAutomationTriggers } from './purchasing-automation.triggers.js';

@Module({
  imports: [PermissionsModule, WarehouseModule, ModuleGuardModule, AutomationModule],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseReturnsController],
  providers: [PurchaseOrdersService, PurchaseReturnsService, PurchasingAutomationTriggers],
  exports: [PurchaseOrdersService],
})
export class PurchasingModule {}
