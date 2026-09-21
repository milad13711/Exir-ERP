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
import { AdminPushController } from './admin-push.controller.js';
import { PushNotificationsModule } from '../notifications/push-notifications.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PublicModule } from '../public/public.module.js';
import { ReferralMarketingModule } from '../referral-marketing/referral-marketing.module.js';
import { AdminResellersController } from './admin-resellers.controller.js';
import { AdminSmsPackagesController } from './admin-sms-packages.controller.js';
import { AdminResellerApplicationsController } from './admin-reseller-applications.controller.js';
import { ResellerApplicationsService } from './reseller-applications.service.js';

@Module({
  imports: [NotificationsModule, PublicModule, ReferralMarketingModule, TenantsModule, LicensingModule, BillingModule, SupportModule, PushNotificationsModule],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminSupportController,
    AdminLogsController,
    AdminLicensesController,
    AdminCatalogController,
    AdminInternalController,
    AdminPushController,
    AdminResellerApplicationsController,
    AdminSmsPackagesController,
    AdminResellersController,
  ],
  providers: [AdminAuthService, AdminSupportService, ResellerApplicationsService],
})
export class AdminModule {}
