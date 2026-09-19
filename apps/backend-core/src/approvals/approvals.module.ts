import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
