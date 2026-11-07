import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PublicInvoicePaymentController } from './public-invoice-payment.controller.js';
import { BillingDunningService } from './billing-dunning.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { ZarinpalService } from './zarinpal.service.js';
import { SmsModule } from '../sms/sms.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ModulesCatalogModule } from '../modules-catalog/modules-catalog.module.js';
import { SubscriptionSummaryController } from './subscription-summary.controller.js';
import { SubscriptionSummaryService } from './subscription-summary.service.js';

@Module({
  imports: [SmsModule, TenantsModule, ModulesCatalogModule],
  controllers: [BillingController, SubscriptionSummaryController, PublicInvoicePaymentController],
  providers: [BillingDunningService, InvoicePdfService, ZarinpalService, SubscriptionSummaryService],
  exports: [InvoicePdfService, ZarinpalService, SubscriptionSummaryService],
})
export class BillingModule {}
