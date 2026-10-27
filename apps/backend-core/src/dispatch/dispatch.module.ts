import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { DispatchAdjustmentService } from './dispatch-adjustment.service.js';
import { DispatchReceiptService } from './dispatch-receipt.service.js';
import { DispatchReceiptPdfService } from './dispatch-receipt-pdf.service.js';
import { DispatchSuggestionsService } from './dispatch-suggestions.service.js';
import { DispatchReportService } from './dispatch-report.service.js';
import { DispatchCronService } from './dispatch-cron.service.js';
import { PublicDispatchReceiptController, PublicDispatchReceiptService } from './dispatch-public.js';

/**
 * «اعلام بار، بارنامه و برگ قرنطینه» — گردش‌کار لایه‌شده روی Shipment ماژول ناوگان (fleet).
 * ApprovalsModule و SignatureEvidenceModule سراسری‌اند (Global).
 */
@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule, SmsModule, FleetModule, SalesModule],
  controllers: [DispatchController, PublicDispatchReceiptController],
  providers: [
    DispatchService,
    DispatchRulesService,
    DispatchAdjustmentService,
    DispatchReceiptService,
    DispatchReceiptPdfService,
    DispatchSuggestionsService,
    DispatchReportService,
    DispatchCronService,
    PublicDispatchReceiptService,
  ],
  exports: [DispatchService, DispatchRulesService, DispatchReportService],
})
export class DispatchModule {}
