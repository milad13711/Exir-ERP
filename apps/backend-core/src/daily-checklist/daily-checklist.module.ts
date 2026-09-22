import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DailyChecklistController } from './daily-checklist.controller.js';
import { DailyChecklistService } from './daily-checklist.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, ReportsModule],
  controllers: [DailyChecklistController],
  providers: [DailyChecklistService],
})
export class DailyChecklistModule {}
