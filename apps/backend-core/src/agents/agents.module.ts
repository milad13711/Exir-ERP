import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ReferralMarketingModule } from '../referral-marketing/referral-marketing.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { AgentApiService } from './agent-api.service.js';
import { AgentCustomersService } from './agent-customers.service.js';
import { AgentIngestService } from './agent-ingest.service.js';
import { AgentProductsService } from './agent-products.service.js';
import { AgentRenewalReminderService } from './agent-renewal-reminder.service.js';
import { AgentsAdminController } from './agents-admin.controller.js';
import { AgentsMeController } from './agents-me.controller.js';
import { AgentsPublicApiController } from './agents-public-api.controller.js';
import { AgentsService } from './agents.service.js';
import { AgentCommissionService } from './agent-commission.service.js';
import { AgentPayoutsService } from './agent-payouts.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, ReferralMarketingModule, SmsModule],
  controllers: [AgentsAdminController, AgentsMeController, AgentsPublicApiController],
  providers: [AgentsService, AgentProductsService, AgentCustomersService, AgentIngestService, AgentApiService, AgentRenewalReminderService, AgentCommissionService, AgentPayoutsService],
  exports: [AgentsService],
})
export class AgentsModule {}
