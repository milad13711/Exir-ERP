import { Global, Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service.js';
import { ActivityRetentionService } from './activity-retention.service.js';
import { DailyReportSubmissionService } from './daily-report-submissions.service.js';
import { ActivitySystemSyncService } from './activity-system-sync.service.js';

/** سراسری: هر ماژول بدون import اضافه می‌تواند ActivityLogService را تزریق کند. */
@Global()
@Module({
  providers: [ActivityLogService, DailyReportSubmissionService, ActivityRetentionService, ActivitySystemSyncService],
  exports: [ActivityLogService, DailyReportSubmissionService],
})
export class ActivityLogModule {}
