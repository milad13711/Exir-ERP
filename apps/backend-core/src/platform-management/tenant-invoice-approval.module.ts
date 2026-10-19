import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { TenantInvoiceApprovalService } from './tenant-invoice-approval.service.js';

/** ApprovalsModule سراسری (Global) است؛ PrismaModule هم. */
@Module({
  imports: [NotificationsModule, SmsModule],
  providers: [TenantInvoiceApprovalService],
  exports: [TenantInvoiceApprovalService],
})
export class TenantInvoiceApprovalModule {}
