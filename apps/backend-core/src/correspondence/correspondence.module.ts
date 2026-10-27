import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CorrespondenceController } from './correspondence.controller.js';
import { CorrespondenceCoreService } from './correspondence-core.service.js';
import { CorrespondenceCronService } from './correspondence-cron.service.js';
import { CorrespondenceLettersService } from './correspondence-letters.service.js';
import { CorrespondenceNumberingService } from './correspondence-numbering.service.js';
import { CorrespondencePublicController, CorrespondencePublicService } from './correspondence-public.js';
import { CorrespondenceSignatureService } from './correspondence-signature.service.js';
import { CorrespondenceReferralsService } from './correspondence-referrals.service.js';
import { CorrespondenceRenderService } from './correspondence-render.service.js';
import { CorrespondenceSettingsService } from './correspondence-settings.service.js';
import { CorrespondenceWorkflowService } from './correspondence-workflow.service.js';
import { CorrespondenceDocsModule } from './docs.module.js';

/**
 * «مکاتبات سازمانی» (دبیرخانه). سربرگ/قالب/PDF در CorrespondenceDocsModule است.
 * SignatureEvidenceModule و ApprovalsModule سراسری‌اند (Global).
 */
@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule, SettingsModule, CorrespondenceDocsModule],
  controllers: [CorrespondenceController, CorrespondencePublicController],
  providers: [
    CorrespondenceCoreService,
    CorrespondenceNumberingService,
    CorrespondenceSettingsService,
    CorrespondenceReferralsService,
    CorrespondenceLettersService,
    CorrespondenceRenderService,
    CorrespondenceSignatureService,
    CorrespondenceWorkflowService,
    CorrespondenceCronService,
    CorrespondencePublicService,
  ],
  exports: [CorrespondenceCoreService, CorrespondenceLettersService],
})
export class CorrespondenceModule {}
