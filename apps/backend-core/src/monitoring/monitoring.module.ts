import { Module } from '@nestjs/common';
import { BackupDrModule } from '../backup-dr/backup-dr.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { AdminMonitoringController } from './admin-monitoring.controller.js';
import { HealthController } from './health.controller.js';
import { InternalAlertController } from './internal-alert.controller.js';
import { MonitoringService } from './monitoring.service.js';

@Module({
  imports: [SmsModule, BackupDrModule],
  controllers: [AdminMonitoringController, InternalAlertController, HealthController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
