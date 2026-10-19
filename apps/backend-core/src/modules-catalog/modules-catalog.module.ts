import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { TenantInvoiceApprovalModule } from '../platform-management/tenant-invoice-approval.module.js';
import { ModulesCatalogController } from './modules-catalog.controller.js';
import { ModuleRenewalService } from './module-renewal.service.js';

@Module({
  imports: [SmsModule, TenantInvoiceApprovalModule],
  controllers: [ModulesCatalogController],
  providers: [ModuleRenewalService],
})
export class ModulesCatalogModule {}
