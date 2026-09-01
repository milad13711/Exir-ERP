import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ProductsController } from './products.controller.js';
import { MovementsController } from './movements.controller.js';
import { WarehouseSummaryController } from './summary.controller.js';
import { WarehousesController } from './warehouses.controller.js';
import { CostingSettingsController } from './costing-settings.controller.js';
import { CostingService } from './costing.service.js';

@Module({
  imports: [WebhooksModule, PermissionsModule, ModuleGuardModule],
  controllers: [ProductsController, MovementsController, WarehouseSummaryController, WarehousesController, CostingSettingsController],
  providers: [CostingService],
  exports: [CostingService],
})
export class WarehouseModule {}
