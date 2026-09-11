import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AfterSalesController } from './after-sales.controller.js';
import { AfterSalesService } from './after-sales.service.js';
import { AfterSalesAutomationTriggers } from './after-sales-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, NotificationsModule],
  controllers: [AfterSalesController],
  providers: [AfterSalesService, AfterSalesAutomationTriggers],
  exports: [AfterSalesService],
})
export class AfterSalesModule {}
