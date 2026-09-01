import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller.js';
import { AttendanceController } from './attendance.controller.js';
import { LeaveController } from './leave.controller.js';
import { PayrollController } from './payroll.controller.js';
import { HrSummaryController } from './summary.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { ModuleGuardModule } from '../common/guards/module-guard.module.js';

@Module({
  imports: [NotificationsModule, PermissionsModule, ModuleGuardModule],
  controllers: [
    EmployeesController,
    AttendanceController,
    LeaveController,
    PayrollController,
    HrSummaryController,
  ],
})
export class HrModule {}
