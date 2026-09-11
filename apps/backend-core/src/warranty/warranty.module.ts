import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WarrantyController } from './warranty.controller.js';
import { WarrantyService } from './warranty.service.js';
import { WarrantyLabelPdfService } from './warranty-label-pdf.service.js';
import { WarrantyReminderService } from './warranty-reminder.service.js';
import { WarrantyAutomationTriggers } from './warranty-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, NotificationsModule],
  controllers: [WarrantyController],
  providers: [WarrantyService, WarrantyLabelPdfService, WarrantyReminderService, WarrantyAutomationTriggers],
  exports: [WarrantyService],
})
export class WarrantyModule {}
