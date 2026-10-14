import { Global, Module } from '@nestjs/common';
import { PermissionsModule } from '../../permissions/permissions.module.js';
import { SignatureEvidenceController } from './signature-evidence.controller.js';
import { SignatureEvidenceService } from './signature-evidence.service.js';

@Global()
@Module({
  imports: [PermissionsModule],
  controllers: [SignatureEvidenceController],
  providers: [SignatureEvidenceService],
  exports: [SignatureEvidenceService],
})
export class SignatureEvidenceModule {}
