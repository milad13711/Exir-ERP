import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RationSamplesController } from './samples.controller.js';
import { RationLabReviewersController } from './lab-reviewers.controller.js';
import { RationDiscountCodesController } from './discount-codes.controller.js';
import { RationFollowupsController } from './followups.controller.js';
import { RationReportsController } from './ration-reports.controller.js';
import { RationReportPdfService } from './ration-report-pdf.service.js';
import { RationFollowUpCronService } from './ration-followup-cron.service.js';

/**
 * بخش پنل کارشناس (authenticated) این ماژول. دو پورتال عمومی
 * (PublicLabReviewController/PublicRationResultController) — طبق قرارداد
 * این کدبیس که همه‌ی کنترلرهای public/... را در PublicModule جمع می‌کند،
 * نه پخش در ماژول هر ویژگی — در public/public.module.ts ثبت شده‌اند، نه
 * اینجا؛ فایل‌هایشان اما در همین پوشه (ration-lab/public/) هستند.
 */
@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule],
  controllers: [RationSamplesController, RationLabReviewersController, RationDiscountCodesController, RationFollowupsController, RationReportsController],
  providers: [RationReportPdfService, RationFollowUpCronService],
})
export class RationLabModule {}
