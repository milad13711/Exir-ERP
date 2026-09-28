import { Module } from '@nestjs/common';
import { CertificatesController } from './certificates.controller.js';
import { CertificateRenderService } from './certificate-render.service.js';
import { CertificateTemplateSettingsService } from './certificate-template-settings.service.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, SettingsModule],
  controllers: [CertificatesController],
  providers: [CertificateRenderService, CertificateTemplateSettingsService],
  exports: [CertificateRenderService, CertificateTemplateSettingsService],
})
export class CertificatesModule {}
