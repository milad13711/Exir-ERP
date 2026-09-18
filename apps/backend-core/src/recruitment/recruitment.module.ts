import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { UsersModule } from '../users/users.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { RecruitmentController } from './recruitment.controller.js';
import { RecruitmentService } from './recruitment.service.js';
import { RecruitmentOfferPdfService } from './recruitment-offer-pdf.service.js';
import { RecruitmentAutomationTriggers } from './recruitment-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, UsersModule, SettingsModule],
  controllers: [RecruitmentController],
  providers: [RecruitmentService, RecruitmentOfferPdfService, RecruitmentAutomationTriggers],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
