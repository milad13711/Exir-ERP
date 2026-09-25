import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DailyChecklistController } from './daily-checklist.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DailyChecklistCronService } from './daily-checklist-cron.service.js';
import { DailyChecklistService } from './daily-checklist.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, ReportsModule, NotificationsModule],
  controllers: [DailyChecklistController],
  providers: [DailyChecklistService, DailyChecklistCronService],
})
export class DailyChecklistModule {}
