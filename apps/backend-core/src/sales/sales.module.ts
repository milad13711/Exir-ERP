import { SettingsModule } from '../settings/settings.module.js';
import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WarehouseModule } from '../warehouse/warehouse.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { WarrantyModule } from '../warranty/warranty.module.js';
import { ReferralMarketingModule } from '../referral-marketing/referral-marketing.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { SalesInvoicePdfService } from './sales-invoice-pdf.service.js';
import { PaymentReminderService } from './payment-reminder.service.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';
import { PublicQuotationsController } from './public-quotations.controller.js';
import { PublicSalesInvoiceController } from './public-sales-invoice.controller.js';
import { SalesReturnsController } from './sales-returns.controller.js';
import { SalesReturnsService } from './sales-returns.service.js';
import { RecurringInvoicesController } from './recurring-invoices.controller.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';
import { SalesAutomationTriggers } from './sales-automation.triggers.js';
import { InvoiceSigningService } from './invoice-signing.service.js';
import { PublicInvoiceDeliveryService } from './public-invoice-delivery.service.js';
import { SalesAccountingBackfillController } from './sales-accounting-backfill.controller.js';
import { SalesAccountingBackfillService } from './sales-accounting-backfill.service.js';

@Module({
  imports: [PermissionsModule, SmsModule, CrmModule, NotificationsModule, WarehouseModule, ModuleGuardModule, AutomationModule, BillingModule, PaymentGatewayModule, WarrantyModule, ReferralMarketingModule, SettingsModule],
  controllers: [
    InvoicesController,
    QuotationsController,
    PublicQuotationsController,
    PublicSalesInvoiceController,
    SalesReturnsController,
    RecurringInvoicesController,
    SalesAccountingBackfillController,
  ],
  providers: [
    InvoicesService,
    SalesInvoicePdfService,
    PaymentReminderService,
    QuotationsService,
    SalesReturnsService,
    RecurringInvoicesService,
    SalesAutomationTriggers,
    InvoiceSigningService,
    PublicInvoiceDeliveryService,
    SalesAccountingBackfillService,
  ],
  exports: [InvoicesService, PaymentReminderService],
})
export class SalesModule {}
