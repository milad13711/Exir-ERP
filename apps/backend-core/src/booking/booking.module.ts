import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { ServiceTypesController } from './service-types.controller.js';
import { ServiceTypesService } from './service-types.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { BookingAutomationTriggers } from './booking-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule],
  controllers: [ServiceTypesController, AppointmentsController],
  providers: [ServiceTypesService, AppointmentsService, BookingAutomationTriggers],
})
export class BookingModule {}
