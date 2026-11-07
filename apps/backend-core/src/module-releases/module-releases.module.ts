import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { ModuleReleasesController } from './module-releases.controller.js';
import { ModuleReleasesTenantService } from './module-releases-tenant.service.js';
import { ModuleReleasesAdminService } from './module-releases-admin.service.js';
import { ModuleReleaseFanoutService } from './module-release-fanout.service.js';

/** کنترلر ادمین (AdminModuleReleasesController) در AdminModule ثبت می‌شود تا گاردهای ادمین همان‌جا resolve شوند. */
@Module({
  imports: [SmsModule],
  controllers: [ModuleReleasesController],
  providers: [ModuleReleasesTenantService, ModuleReleasesAdminService, ModuleReleaseFanoutService],
  exports: [ModuleReleasesAdminService, ModuleReleaseFanoutService],
})
export class ModuleReleasesModule {}
