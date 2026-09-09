import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { EventsQrService } from './events-qr.service.js';
import { EventsPosterService } from './events-poster.service.js';
import { EventsTicketPdfService } from './events-ticket-pdf.service.js';
import { EventsAutomationTriggers } from './events-automation.triggers.js';
import { EventsStatusCronService } from './events-status-cron.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, SalesModule],
  controllers: [EventsController],
  providers: [EventsService, EventsQrService, EventsPosterService, EventsTicketPdfService, EventsAutomationTriggers, EventsStatusCronService],
  exports: [EventsService, EventsQrService, EventsTicketPdfService],
})
export class EventsModule {}
