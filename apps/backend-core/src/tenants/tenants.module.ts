import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';
import { TrialExpiryCronService } from './trial-expiry-cron.service.js';

@Module({
  providers: [TenantsService, TenantDbAdminService, TrialExpiryCronService],
  exports: [TenantsService, TenantDbAdminService],
})
export class TenantsModule {}
