import { Module } from '@nestjs/common';
import { ConfidentialArchiveController } from './confidential-archive.controller.js';
import { ConfidentialArchiveService } from './confidential-archive.service.js';
import { VaultTicketGuard } from './guards/vault-ticket.guard.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [ModuleGuardModule, AuthModule],
  controllers: [ConfidentialArchiveController],
  providers: [ConfidentialArchiveService, VaultTicketGuard],
})
export class ConfidentialArchiveModule {}
