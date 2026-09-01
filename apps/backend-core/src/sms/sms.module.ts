import { Module } from '@nestjs/common';
import { ExirSmsService } from './exir-sms.service.js';

@Module({
  providers: [ExirSmsService],
  exports: [ExirSmsService],
})
export class SmsModule {}
