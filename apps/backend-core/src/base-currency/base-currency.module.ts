import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { BackupDrModule } from '../backup-dr/backup-dr.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { BaseCurrencyController } from './base-currency.controller.js';
import { BaseCurrencyService } from './base-currency.service.js';
import { BaseCurrencyWriteLockInterceptor } from './write-lock.interceptor.js';

@Module({
  imports: [ModuleGuardModule, BackupDrModule, SmsModule],
  controllers: [BaseCurrencyController],
  providers: [BaseCurrencyService, { provide: APP_INTERCEPTOR, useClass: BaseCurrencyWriteLockInterceptor }],
  exports: [BaseCurrencyService],
})
export class BaseCurrencyModule {}
