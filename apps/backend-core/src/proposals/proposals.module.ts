import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ProposalsController } from './proposals.controller.js';
import { PublicProposalsController } from './public-proposals.controller.js';
import { ProposalsService } from './proposals.service.js';
import { PublicProposalsService } from './public-proposals.service.js';
import { ProposalTemplatesService } from './proposal-templates.service.js';
import { ProposalsAutomationTriggers } from './proposals-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, NotificationsModule, SmsModule, SalesModule],
  controllers: [ProposalsController, PublicProposalsController],
  providers: [ProposalsService, PublicProposalsService, ProposalTemplatesService, ProposalsAutomationTriggers],
  exports: [ProposalsService],
})
export class ProposalsModule {}
