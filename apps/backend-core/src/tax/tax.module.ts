import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MOODIAN_CLIENT_FACTORY } from './client/moodian-client.js';
import { HttpMoodianClientFactory } from './client/http-moodian.client.js';
import { TaxController } from './tax.controller.js';
import { TaxInvoicesService } from './tax-invoices.service.js';
import { TaxSettingsService } from './tax-settings.service.js';
import { TaxProductsService } from './tax-products.service.js';
import { TaxAuditService } from './tax-audit.service.js';
import { TaxWorkerService } from './tax-worker.service.js';
import { TaxAutomationTriggers } from './tax-automation.triggers.js';

/**
 * ماژول «مالیات و صورتحساب الکترونیکی (سامانه مودیان)» — فاز ۱.
 * ApprovalsModule سراسری (@Global) است؛ کلاینت واقعی مودیان فقط از طریق توکن MOODIAN_CLIENT_FACTORY تزریق می‌شود
 * (در تست با کلاینت جعلی جایگزین می‌شود).
 */
@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, NotificationsModule],
  controllers: [TaxController],
  providers: [
    { provide: MOODIAN_CLIENT_FACTORY, useClass: HttpMoodianClientFactory },
    TaxAuditService,
    TaxSettingsService,
    TaxProductsService,
    TaxInvoicesService,
    TaxWorkerService,
    TaxAutomationTriggers,
  ],
  exports: [TaxInvoicesService],
})
export class TaxModule {}
