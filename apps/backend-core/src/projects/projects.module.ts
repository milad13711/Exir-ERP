import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { StageTemplatesService } from './stage-templates.service.js';
import { ProjectsReminderService } from './projects-reminder.service.js';
import { ProjectsAutomationTriggers } from './projects-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, NotificationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, StageTemplatesService, ProjectsReminderService, ProjectsAutomationTriggers],
  exports: [ProjectsService],
})
export class ProjectsModule {}
