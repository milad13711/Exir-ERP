import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { BomsController } from './boms.controller.js';
import { WorkCentersController } from './work-centers.controller.js';
import { ProductionOrdersController } from './orders.controller.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule],
  controllers: [BomsController, WorkCentersController, ProductionOrdersController],
})
export class ProductionModule {}
