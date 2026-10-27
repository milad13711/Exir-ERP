import { Injectable } from '@nestjs/common';
import { InvoicesService } from '../sales/invoices.service.js';
import { PurchaseOrdersService } from '../purchasing/purchase-orders.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { OperationsService } from '../operations/operations.service.js';
import { CorrespondenceCoreService } from '../correspondence/correspondence-core.service.js';
import { CorrespondenceLettersService } from '../correspondence/correspondence-letters.service.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { DispatchReportService } from '../dispatch/dispatch-report.service.js';
import { BookingSlotsService } from '../booking/booking-slots.service.js';
import { AppointmentsService } from '../booking/appointments.service.js';
import { ServiceTypesService } from '../booking/service-types.service.js';
import { FunnelService } from '../crm/funnel.service.js';
import { DashboardRemindersService } from '../dashboard/dashboard-reminders.service.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { buildAllMcpTools } from './mcp-registry.js';
import type { McpTool } from './mcp-tool.types.js';
import { validateToolArgs } from './mcp-validate.js';

/**
 * فهرست ابزارها را یک‌بار می‌سازد. هر handler با یک پوشش ساخته می‌شود که همیشه (هم در اجرای فوری ابزارهای read و هم هنگام
 * اجرای پس از تأییدِ ابزارهای write) ورودی را دوباره اعتبارسنجی می‌کند و نصب‌بودن ماژول را می‌سنجد.
 */
@Injectable()
export class McpToolsService {
  readonly tools: McpTool[];

  constructor(
    invoices: InvoicesService,
    purchaseOrders: PurchaseOrdersService,
    controlDb: ControlPrismaService,
    tasks: TasksService,
    operations: OperationsService,
    corrCore: CorrespondenceCoreService,
    corrLetters: CorrespondenceLettersService,
    dispatch: DispatchService,
    dispatchReport: DispatchReportService,
    slots: BookingSlotsService,
    appointments: AppointmentsService,
    serviceTypes: ServiceTypesService,
    funnel: FunnelService,
    reminders: DashboardRemindersService,
    private readonly moduleGuard: ModuleGuard,
  ) {
    const raw = buildAllMcpTools({
      invoices, purchaseOrders, controlDb, tasks, operations, corrCore, corrLetters, dispatch, dispatchReport, slots, appointments, serviceTypes, funnel, reminders,
    });
    this.tools = raw.map((t) => ({
      ...t,
      handler: async (args, ctx) => {
        await this.precheck(t, args, ctx);
        return t.handler(args, ctx);
      },
    }));
  }

  /** اعتبارسنجی ورودی + نصب‌بودن ماژول؛ خطا = Error با پیام فارسی (به‌صورت isError به ایجنت می‌رسد). */
  async precheck(tool: McpTool, args: Record<string, unknown>, ctx: TenantRequestContext): Promise<void> {
    validateToolArgs(tool, args);
    const reason = await this.moduleGuard.moduleUnavailableReason(ctx.tenantId, tool.module);
    if (reason) throw new Error(reason);
  }
}
