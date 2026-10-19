import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardCalendarService } from './dashboard-calendar.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DashboardRemindersService } from './dashboard-reminders.service.js';
import { RemindersCronService } from './reminders-cron.service.js';
import { InvoiceDueRemindersService } from './invoice-due-reminders.service.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';

@Module({
  imports: [PermissionsModule, SalesModule, NotificationsModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardCalendarService, InvoiceDueRemindersService, DashboardRemindersService, RemindersCronService, DashboardLayoutService],
})
export class DashboardModule {}
