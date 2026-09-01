import { Module } from '@nestjs/common';
import { GeneralSettingsController } from './general-settings.controller.js';
import { CurrenciesController } from './currencies.controller.js';
import { BackupController } from './backup.controller.js';

@Module({ controllers: [GeneralSettingsController, CurrenciesController, BackupController] })
export class SettingsModule {}
