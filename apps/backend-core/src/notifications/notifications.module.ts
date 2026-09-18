import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { EmailModule } from '../email/email.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { PushNotificationsModule } from './push-notifications.module.js';

@Module({
  imports: [EmailModule, SmsModule, PushNotificationsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, PushNotificationsModule],
})
export class NotificationsModule {}
