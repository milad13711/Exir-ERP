import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { SupportModule } from '../support/support.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlatformManagementController } from './platform-management.controller.js';
import { PlatformManagementService } from './platform-management.service.js';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard.js';

@Module({
  imports: [TenantsModule, SupportModule, NotificationsModule],
  controllers: [PlatformManagementController],
  providers: [PlatformManagementService, PlatformOwnerGuard],
})
export class PlatformManagementModule {}
