import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AccountsController } from './accounts.controller.js';
import { JournalEntriesController } from './journal-entries.controller.js';
import { AccountingSummaryController } from './summary.controller.js';
import { ReportsController } from './reports.controller.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { BudgetsController } from './budgets.controller.js';
import { FixedAssetsController } from './fixed-assets.controller.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule],
  controllers: [
    AccountsController,
    JournalEntriesController,
    AccountingSummaryController,
    ReportsController,
    ReconciliationController,
    BudgetsController,
    FixedAssetsController,
  ],
})
export class AccountingModule {}
