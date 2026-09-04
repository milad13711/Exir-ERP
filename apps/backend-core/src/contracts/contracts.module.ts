import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { ContractsReminderService } from './contracts-reminder.service.js';
import { ContractsAutomationTriggers } from './contracts-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractsReminderService, ContractsAutomationTriggers],
  exports: [ContractsService],
})
export class ContractsModule {}
