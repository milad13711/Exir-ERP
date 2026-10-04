import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { VoipProviderRegistryService } from './voip-provider-registry.service.js';
import { VoipGateway } from './voip.gateway.js';
import { VoipController } from './voip.controller.js';
import { VoipWebhookController } from './voip-webhook.controller.js';
import { GenericWebhookVoipProvider } from './providers/generic-webhook.provider.js';
import { NovatelVoipProvider } from './providers/novatel.provider.js';
import { VoipAutomationTriggers } from './voip-automation.triggers.js';
import { NavatelApiService } from './navatel-api.service.js';
import { NavatelReportsController } from './navatel-reports.controller.js';
import { CallLogService } from './call-log.service.js';

@Module({
  imports: [ModuleGuardModule, AutomationModule, PermissionsModule],
  controllers: [VoipController, VoipWebhookController, NavatelReportsController],
  providers: [
    VoipProviderRegistryService,
    VoipGateway,
    GenericWebhookVoipProvider,
    NovatelVoipProvider,
    VoipAutomationTriggers,
    CallLogService,
    NavatelApiService,
  ],
})
export class VoipModule {}
