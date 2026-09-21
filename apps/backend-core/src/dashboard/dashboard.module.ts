import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [PermissionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
