import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { SupportGateway } from './support.gateway.js';
import { PushNotificationsModule } from '../notifications/push-notifications.module.js';

@Module({
  imports: [PushNotificationsModule],
  controllers: [SupportController],
  providers: [SupportService, SupportGateway],
  exports: [SupportGateway],
})
export class SupportModule {}
