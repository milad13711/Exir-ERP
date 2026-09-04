import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WarehouseModule } from '../warehouse/warehouse.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { SalesInvoicePdfService } from './sales-invoice-pdf.service.js';
import { PaymentReminderService } from './payment-reminder.service.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';
import { PublicQuotationsController } from './public-quotations.controller.js';
import { SalesReturnsController } from './sales-returns.controller.js';
import { SalesReturnsService } from './sales-returns.service.js';
import { RecurringInvoicesController } from './recurring-invoices.controller.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';
import { SalesAutomationTriggers } from './sales-automation.triggers.js';

@Module({
  imports: [PermissionsModule, SmsModule, CrmModule, NotificationsModule, WarehouseModule, ModuleGuardModule, AutomationModule],
  controllers: [
    InvoicesController,
    QuotationsController,
    PublicQuotationsController,
    SalesReturnsController,
    RecurringInvoicesController,
  ],
  providers: [
    InvoicesService,
    SalesInvoicePdfService,
    PaymentReminderService,
    QuotationsService,
    SalesReturnsService,
    RecurringInvoicesService,
    SalesAutomationTriggers,
  ],
  exports: [InvoicesService],
})
export class SalesModule {}
