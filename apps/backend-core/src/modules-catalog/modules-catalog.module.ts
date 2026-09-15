import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module.js';
import { ModulesCatalogController } from './modules-catalog.controller.js';
import { ModuleRenewalService } from './module-renewal.service.js';

@Module({
  imports: [SmsModule],
  controllers: [ModulesCatalogController],
  providers: [ModuleRenewalService],
})
export class ModulesCatalogModule {}
