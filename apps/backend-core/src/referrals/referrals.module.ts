import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

@Global()
@Module({
  imports: [NotificationsModule, PermissionsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
