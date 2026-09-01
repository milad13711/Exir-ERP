import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingDunningService } from './billing-dunning.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { SmsModule } from '../sms/sms.module.js';

@Module({
  imports: [SmsModule],
  controllers: [BillingController],
  providers: [BillingDunningService, InvoicePdfService],
  exports: [InvoicePdfService],
})
export class BillingModule {}
