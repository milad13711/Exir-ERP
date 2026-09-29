import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardCalendarService } from './dashboard-calendar.service.js';
import { InvoiceDueRemindersService } from './invoice-due-reminders.service.js';

@Module({
  imports: [PermissionsModule, SalesModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardCalendarService, InvoiceDueRemindersService],
})
export class DashboardModule {}
