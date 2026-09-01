import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ContactsController } from './contacts.controller.js';
import { DealsController } from './deals.controller.js';
import { CreditScoreService } from './credit-score.service.js';
import { SupplierRiskService } from './supplier-risk.service.js';
import { PartyStatementService } from './party-statement.service.js';
import { PartyTransactionsService } from './party-transactions.service.js';

@Module({
  imports: [WebhooksModule, PermissionsModule, NotificationsModule, ModuleGuardModule],
  controllers: [ContactsController, DealsController],
  providers: [CreditScoreService, SupplierRiskService, PartyStatementService, PartyTransactionsService],
  exports: [CreditScoreService, SupplierRiskService],
})
export class CrmModule {}
