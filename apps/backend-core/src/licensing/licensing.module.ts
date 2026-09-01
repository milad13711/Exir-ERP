import { Module } from '@nestjs/common';
import { LicenseIssuerService } from './license-issuer.service.js';
import { LicenseRuntimeService } from './license-runtime.service.js';
import { LicenseStatusController } from './license-status.controller.js';
import { LicenseCheckinController } from './license-checkin.controller.js';

@Module({
  controllers: [LicenseStatusController, LicenseCheckinController],
  providers: [LicenseIssuerService, LicenseRuntimeService],
  exports: [LicenseIssuerService, LicenseRuntimeService],
})
export class LicensingModule {}
