import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { FleetOfferDispatchService } from './fleet-offer-dispatch.service.js';
import { FleetAutomationTriggers } from './fleet-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, NotificationsModule, SmsModule],
  controllers: [DriversController, ShipmentsController],
  providers: [DriversService, ShipmentsService, FleetOfferDispatchService, FleetAutomationTriggers],
  exports: [DriversService, ShipmentsService],
})
export class FleetModule {}
