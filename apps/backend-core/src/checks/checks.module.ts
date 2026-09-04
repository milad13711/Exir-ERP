import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';
import { ChecksReminderService } from './checks-reminder.service.js';
import { ChecksAutomationTriggers } from './checks-automation.triggers.js';

@Module({
  imports: [PermissionsModule, SmsModule, NotificationsModule, ModuleGuardModule, AutomationModule],
  controllers: [ChecksController],
  providers: [ChecksService, ChecksReminderService, ChecksAutomationTriggers],
})
export class ChecksModule {}
