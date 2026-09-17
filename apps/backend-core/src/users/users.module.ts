import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [SmsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
