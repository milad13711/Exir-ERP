import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { AuthService } from './auth.service.js';
import { AuthController, TwoFactorController } from './auth.controller.js';
import { TenantTwoFactorService } from './tenant-two-factor.service.js';

@Module({
  imports: [SmsModule],
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, TenantTwoFactorService],
  exports: [AuthService, TenantTwoFactorService],
})
export class AuthModule {}
