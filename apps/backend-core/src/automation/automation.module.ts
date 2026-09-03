import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { TriggerRegistryService } from './trigger-registry.service.js';
import { AutomationEngineService } from './automation-engine.service.js';
import { AutomationController } from './automation.controller.js';

/**
 * Foundational module — imported by any feature module that wants to
 * register triggers or emit them (production, sales, hr, ...), the same
 * way every module already imports PermissionsModule/NotificationsModule.
 * This module itself never imports a feature module — that one-way
 * direction is what lets new modules plug in without this one changing.
 */
@Module({
  imports: [PermissionsModule, ModuleGuardModule, NotificationsModule, SmsModule],
  controllers: [AutomationController],
  providers: [TriggerRegistryService, AutomationEngineService],
  exports: [TriggerRegistryService, AutomationEngineService],
})
export class AutomationModule {}
