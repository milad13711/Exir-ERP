import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { LicensingModule } from '../licensing/licensing.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { SupportModule } from '../support/support.module.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminTenantsController } from './admin-tenants.controller.js';
import { AdminSupportService } from './admin-support.service.js';
import { AdminSupportController } from './admin-support.controller.js';
import { AdminLogsController } from './admin-logs.controller.js';
import { AdminLicensesController } from './admin-licenses.controller.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { AdminInternalController } from './admin-internal.controller.js';

@Module({
  imports: [TenantsModule, LicensingModule, BillingModule, SupportModule],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminSupportController,
    AdminLogsController,
    AdminLicensesController,
    AdminCatalogController,
    AdminInternalController,
  ],
  providers: [AdminAuthService, AdminSupportService],
})
export class AdminModule {}
