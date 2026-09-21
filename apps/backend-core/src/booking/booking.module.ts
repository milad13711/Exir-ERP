import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ServiceTypesController } from './service-types.controller.js';
import { ServiceTypesService } from './service-types.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { StaffAvailabilityController } from './staff-availability.controller.js';
import { StaffAvailabilityService } from './staff-availability.service.js';
import { BookingSlotsService } from './booking-slots.service.js';
import { BookingAutomationTriggers } from './booking-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, BillingModule],
  controllers: [ServiceTypesController, AppointmentsController, StaffAvailabilityController],
  providers: [ServiceTypesService, AppointmentsService, StaffAvailabilityService, BookingSlotsService, BookingAutomationTriggers],
  exports: [ServiceTypesService, AppointmentsService, StaffAvailabilityService, BookingSlotsService],
})
export class BookingModule {}
