import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { BookStoreController } from './book-store.controller.js';
import { BookStoreService } from './book-store.service.js';
import { BookStoreSettingsService } from './book-store-settings.service.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, SalesModule],
  controllers: [BookStoreController],
  providers: [BookStoreService, BookStoreSettingsService],
  exports: [BookStoreService, BookStoreSettingsService],
})
export class BookStoreModule {}
