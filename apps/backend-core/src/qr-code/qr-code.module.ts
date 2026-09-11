import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { QrCodeController } from './qr-code.controller.js';
import { QrCodeService } from './qr-code.service.js';
import { QrCodeImageService } from './qr-code-image.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule],
  controllers: [QrCodeController],
  providers: [QrCodeService, QrCodeImageService],
  exports: [QrCodeService],
})
export class QrCodeModule {}
