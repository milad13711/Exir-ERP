import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { LeaveController } from './leave.controller.js';
import { PayrollController } from './payroll.controller.js';
import { PayrollPdfService } from './payroll-pdf.service.js';
import { HrSummaryController } from './summary.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { HrAutomationTriggers } from './hr-automation.triggers.js';
import { CertificatesController } from './certificates.controller.js';
import { CertificateImageService } from './certificate-image.service.js';
import { PersonnelRewardsController, PersonnelPenaltiesController } from './personnel-actions.controller.js';

@Module({
  imports: [NotificationsModule, PermissionsModule, ModuleGuardModule, AutomationModule],
  controllers: [
    EmployeesController,
    AttendanceController,
    LeaveController,
    PayrollController,
    HrSummaryController,
    CertificatesController,
    PersonnelRewardsController,
    PersonnelPenaltiesController,
  ],
  providers: [PayrollPdfService, HrAutomationTriggers, CertificateImageService],
  exports: [CertificateImageService],
})
export class HrModule {}
