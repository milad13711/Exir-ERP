import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { ChecksController } from './checks.controller.js';
import { ChecksService } from './checks.service.js';
import { ChecksReminderService } from './checks-reminder.service.js';

@Module({
  imports: [PermissionsModule, SmsModule, NotificationsModule, ModuleGuardModule],
  controllers: [ChecksController],
  providers: [ChecksService, ChecksReminderService],
})
export class ChecksModule {}
