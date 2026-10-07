import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { FormsController } from './forms.controller.js';
import { FormsService } from './forms.service.js';
import { FormsInboxService } from './forms-inbox.service.js';
import { FormsAutomationTriggers } from './forms-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule],
  controllers: [FormsController],
  providers: [FormsService, FormsInboxService, FormsAutomationTriggers],
  exports: [FormsService, FormsInboxService],
})
export class FormsModule {}
