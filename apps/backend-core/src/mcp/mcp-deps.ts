import type { InvoicesService } from '../sales/invoices.service.js';
import type { PurchaseOrdersService } from '../purchasing/purchase-orders.service.js';
import type { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { TasksService } from '../tasks/tasks.service.js';
import type { OperationsService } from '../operations/operations.service.js';
import type { CorrespondenceCoreService } from '../correspondence/correspondence-core.service.js';
import type { CorrespondenceLettersService } from '../correspondence/correspondence-letters.service.js';
import type { DispatchService } from '../dispatch/dispatch.service.js';
import type { DispatchReportService } from '../dispatch/dispatch-report.service.js';
import type { BookingSlotsService } from '../booking/booking-slots.service.js';
import type { AppointmentsService } from '../booking/appointments.service.js';
import type { ServiceTypesService } from '../booking/service-types.service.js';
import type { FunnelService } from '../crm/funnel.service.js';
import type { DashboardRemindersService } from '../dashboard/dashboard-reminders.service.js';

/** سرویس‌های دامنه که ابزارهای MCP به‌جای دست‌زدن مستقیم به پریزما صدا می‌زنند (تا قواعد شماره‌گذاری، ماشین‌وضعیت و دامنه‌ی دید دور زده نشود). */
export type McpDeps = {
  invoices: InvoicesService;
  purchaseOrders: PurchaseOrdersService;
  controlDb: ControlPrismaService;
  tasks: TasksService;
  operations: OperationsService;
  corrCore: CorrespondenceCoreService;
  corrLetters: CorrespondenceLettersService;
  dispatch: DispatchService;
  dispatchReport: DispatchReportService;
  slots: BookingSlotsService;
  appointments: AppointmentsService;
  serviceTypes: ServiceTypesService;
  funnel: FunnelService;
  reminders: DashboardRemindersService;
};
