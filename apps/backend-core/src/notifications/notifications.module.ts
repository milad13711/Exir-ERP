import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { PushAckController } from './push-ack.controller.js';
import { EmailModule } from '../email/email.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { PushNotificationsModule } from './push-notifications.module.js';

/** @Global: ماژول‌های دیگر (وظایف، …) بدون import صریح می‌توانند NotificationDeliveryService را تزریق و registerHandler کنند. */
@Global()
@Module({
  imports: [EmailModule, SmsModule, PushNotificationsModule],
  controllers: [NotificationsController, PushAckController],
  providers: [NotificationsService, NotificationDeliveryService],
  exports: [NotificationsService, NotificationDeliveryService, PushNotificationsModule],
})
export class NotificationsModule {}
