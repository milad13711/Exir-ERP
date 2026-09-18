import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { TrialExpiryCronService } from './trial-expiry-cron.service.js';
import { ReferralSyncService } from './referral-sync.service.js';
import { ReferralMarketingModule } from '../referral-marketing/referral-marketing.module.js';

@Module({
  imports: [ReferralMarketingModule],
  providers: [TenantsService, TenantDbAdminService, TrialExpiryCronService, ReferralSyncService],
  exports: [TenantsService, TenantDbAdminService],
})
export class TenantsModule {}
