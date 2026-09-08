import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { AudienceService } from './audience.service.js';
import { CampaignImageService } from './campaign-image.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, SmsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, AudienceService, CampaignImageService],
})
export class MarketingModule {}
