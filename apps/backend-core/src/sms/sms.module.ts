import { Module } from '@nestjs/common';
import { ExirSmsService } from './exir-sms.service.js';
import { SmsPanelController } from './sms-panel.controller.js';
import { TenantSmsService } from './tenant-sms.service.js';

@Module({
  controllers: [SmsPanelController],
  providers: [ExirSmsService, TenantSmsService],
  exports: [ExirSmsService, TenantSmsService],
})
export class SmsModule {}
