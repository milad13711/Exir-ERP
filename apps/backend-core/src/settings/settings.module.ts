import { Module } from '@nestjs/common';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { GeneralSettingsController } from './general-settings.controller.js';
import { CurrenciesController } from './currencies.controller.js';
import { BackupController } from './backup.controller.js';
import { BackupService } from './backup.service.js';

@Module({
  imports: [ModuleGuardModule],
  controllers: [GeneralSettingsController, CurrenciesController, BackupController],
  providers: [BackupService],
})
export class SettingsModule {}
