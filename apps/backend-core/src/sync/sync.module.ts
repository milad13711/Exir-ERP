import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { IdempotencyStoreFactory } from './idempotency.store.js';
import { SyncCleanupService } from './sync-cleanup.service.js';
import { SyncPolicyService } from './sync-policy.service.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [ModuleGuardModule, PermissionsModule],
  controllers: [SyncController],
  providers: [SyncService, SyncPolicyService, IdempotencyStoreFactory, SyncCleanupService],
  exports: [IdempotencyStoreFactory, SyncPolicyService, PermissionsModule],
})
export class SyncModule {}
