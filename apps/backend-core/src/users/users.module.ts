import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { OffboardingController } from './offboarding/offboarding.controller.js';
import { OffboardingService } from './offboarding/offboarding.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [SmsModule, NotificationsModule],
  controllers: [UsersController, OffboardingController],
  providers: [UsersService, OffboardingService],
  exports: [UsersService, OffboardingService],
})
export class UsersModule {}
