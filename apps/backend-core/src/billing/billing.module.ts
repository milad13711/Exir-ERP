import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { PublicInvoicePaymentController } from './public-invoice-payment.controller.js';
import { BillingDunningService } from './billing-dunning.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { ZarinpalService } from './zarinpal.service.js';
import { SmsModule } from '../sms/sms.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';

@Module({
  imports: [SmsModule, TenantsModule],
  controllers: [BillingController, PublicInvoicePaymentController],
  providers: [BillingDunningService, InvoicePdfService, ZarinpalService],
  exports: [InvoicePdfService, ZarinpalService],
})
export class BillingModule {}
