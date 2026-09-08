import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { EngagementsController } from './engagements.controller.js';
import { EngagementsService } from './engagements.service.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { MentoringReportsController } from './mentoring-reports.controller.js';
import { MentoringReportsService } from './mentoring-reports.service.js';
import { MentoringReminderService } from './mentoring-reminder.service.js';
import { MentoringAutomationTriggers } from './mentoring-automation.triggers.js';

@Module({
  imports: [PermissionsModule, ModuleGuardModule, AutomationModule, SmsModule, SalesModule],
  controllers: [EngagementsController, SessionsController, GoalsController, MentoringReportsController],
  providers: [
    EngagementsService,
    SessionsService,
    GoalsService,
    MentoringReportsService,
    MentoringReminderService,
    MentoringAutomationTriggers,
  ],
  exports: [EngagementsService, SessionsService, GoalsService],
})
export class MentoringModule {}
