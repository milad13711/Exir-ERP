import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantDbAdminService } from './tenant-db-admin.service.js';

@Module({
  providers: [TenantsService, TenantDbAdminService],
  exports: [TenantsService, TenantDbAdminService],
})
export class TenantsModule {}
