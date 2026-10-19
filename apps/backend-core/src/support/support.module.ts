import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { SupportGateway } from './support.gateway.js';
import { SupportAlertsService } from './support-alerts.service.js';
import { PushNotificationsModule } from '../notifications/push-notifications.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';

@Module({
  imports: [PushNotificationsModule, NotificationsModule, SmsModule],
  controllers: [SupportController],
  providers: [SupportService, SupportGateway, SupportAlertsService],
  exports: [SupportGateway, SupportAlertsService],
})
export class SupportModule {}
