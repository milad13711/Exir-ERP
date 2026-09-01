import { Controller, Get } from '@nestjs/common';
import { LicenseRuntimeService } from './license-runtime.service.js';

/**
 * Public within the deployment (no tenant/admin auth — see the guard in
 * license.guard.ts for why): shows the ERP header/settings screen whether
 * this on-premise install's license is valid and how many days are left,
 * even while the app is otherwise blocked for an expired license.
 */
@Controller('license')
export class LicenseStatusController {
  constructor(private readonly runtime: LicenseRuntimeService) {}

  @Get('status')
  status() {
    return this.runtime.getStatus();
  }
}
