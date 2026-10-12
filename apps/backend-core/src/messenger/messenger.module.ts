import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { PushNotificationsModule } from '../notifications/push-notifications.module.js';
import { MessengerController } from './messenger.controller.js';
import { MessengerGateway } from './messenger.gateway.js';
import { MessengerMediaService } from './messenger-media.service.js';
import { MessengerService } from './messenger.service.js';

@Module({
  imports: [ModuleGuardModule, PushNotificationsModule],
  controllers: [MessengerController],
  providers: [MessengerService, MessengerMediaService, MessengerGateway],
  exports: [MessengerService],
})
export class MessengerModule {}
