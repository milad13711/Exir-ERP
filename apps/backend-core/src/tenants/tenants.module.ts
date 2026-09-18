import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { TrialExpiryCronService } from './trial-expiry-cron.service.js';
import { ReferralSyncService } from './referral-sync.service.js';

@Module({
  providers: [TenantsService, TenantDbAdminService, TrialExpiryCronService, ReferralSyncService],
  exports: [TenantsService, TenantDbAdminService],
})
export class TenantsModule {}
