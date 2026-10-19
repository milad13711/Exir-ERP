import { Global, Module } from '@nestjs/common';
import { LicenseRuntimeService } from './license-runtime.service.js';
import { LicenseStatusController } from './license-status.controller.js';
import { LicenseCheckinController } from './license-checkin.controller.js';
import { LicenseApiController } from './license-api.controller.js';
import { LicenseAdminService } from './license-admin.service.js';
import { LicenseAuditService } from './license-audit.service.js';
import { LicensePublicService } from './license-public.service.js';
import { LicenseSettingsService } from './license-settings.service.js';
import { LicenseSigningService } from './license-signing.service.js';
import { IntegrityService } from './integrity.service.js';

/**
 * Global: ModuleGuard و سرویس‌های کاربران به LicenseRuntimeService نیاز دارند (اعمال مجوز ماژول/سقف کاربر سمت سرور)
 * بدون اینکه هر ماژول جداگانه import کند.
 */
@Global()
@Module({
  controllers: [LicenseStatusController, LicenseCheckinController, LicenseApiController],
  providers: [
    LicenseRuntimeService,
    IntegrityService,
    LicenseAdminService,
    LicenseAuditService,
    LicensePublicService,
    LicenseSettingsService,
    LicenseSigningService,
  ],
  exports: [LicenseRuntimeService, IntegrityService, LicenseAdminService, LicenseSigningService],
})
export class LicensingModule {}
