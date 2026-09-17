import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { ContactsController } from './contacts.controller.js';
import { DealsController } from './deals.controller.js';
import { FunnelController } from './funnel.controller.js';
import { CreditScoreService } from './credit-score.service.js';
import { SupplierRiskService } from './supplier-risk.service.js';
import { PartyStatementService } from './party-statement.service.js';
import { PartyTransactionsService } from './party-transactions.service.js';
import { FunnelService } from './funnel.service.js';
import { FunnelKpiService } from './funnel-kpi.service.js';
import { FunnelChurnCronService } from './funnel-churn-cron.service.js';
import { CrmAutomationTriggers } from './crm-automation.triggers.js';

@Module({
  imports: [WebhooksModule, PermissionsModule, NotificationsModule, ModuleGuardModule, AutomationModule],
  controllers: [ContactsController, DealsController, FunnelController],
  providers: [
    CreditScoreService,
    SupplierRiskService,
    PartyStatementService,
    PartyTransactionsService,
    FunnelService,
    FunnelKpiService,
    FunnelChurnCronService,
    CrmAutomationTriggers,
  ],
  exports: [CreditScoreService, SupplierRiskService, FunnelService, PartyStatementService],
})
export class CrmModule {}
