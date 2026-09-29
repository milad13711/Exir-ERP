import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardCalendarService, type CalendarEvent } from './dashboard-calendar.service.js';
import { InvoiceDueRemindersService } from './invoice-due-reminders.service.js';
import { CreateInvoiceFollowUpDto } from './dto/create-invoice-follow-up.dto.js';
import { CreateDashboardReminderDto } from './dto/create-dashboard-reminder.dto.js';

// نوع رویداد تقویم -> کد ماژولی که مجوز مشاهده‌اش را کنترل می‌کند؛ null یعنی
// همیشه نمایش داده می‌شود (وظیفه/یادآوری دستی، بدون ماژول اختصاصی).
const CALENDAR_EVENT_MODULE: Record<CalendarEvent['type'], string | null> = {
  'birthday-employee': 'hr',
  'birthday-contact': 'crm',
  task: null,
  interview: 'recruitment',
  'mentoring-session': 'mentoring',
  'invoice-due': 'sales',
  'check-due': 'accounting',
  'contract-end': 'contracts',
  reminder: null,
};

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly calendar: DashboardCalendarService,
    private readonly permissions: PermissionsService,
    private readonly dueReminders: InvoiceDueRemindersService,
  ) {}

  /** تقویم ماهانه‌ی داشبورد — تولد/وظیفه/مصاحبه/جلسه/سررسید فاکتور و چک/پایان قرارداد/یادآوری دستی، به تفکیک روز. */
  @Get('calendar')
  async monthCalendar(@Query('year') year: string, @Query('month') month: string, @Ctx() ctx: TenantRequestContext) {
    const [result, acl] = await Promise.all([
      this.calendar.monthCalendar(ctx, Number(year), Number(month)),
      this.permissions.effectiveMatrix(ctx),
    ]);
    if (acl.manager) return result;
    const can = (code: string | null) => {
      if (!code) return true;
      return !!acl.modules[code] && (acl.modules[code].canViewAll || acl.modules[code].canViewOwn);
    };
    return {
      ...result,
      days: result.days.map((d) => {
        const events = d.events.filter((e) => can(CALENDAR_EVENT_MODULE[e.type]));
        return { ...d, events, hasBirthday: events.some((e) => e.type === 'birthday-employee' || e.type === 'birthday-contact') };
      }),
    };
  }

  /** ایجاد یادآوری دستی روی یک روز مشخص از تقویم داشبورد. */
  @Post('reminders')
  async createReminder(@Body() dto: CreateDashboardReminderDto, @Ctx() ctx: TenantRequestContext) {
    return this.calendar.createReminder(ctx, dto);
  }

  /** حذف یک یادآوری دستی. */
  @Delete('reminders/:id')
  async deleteReminder(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.calendar.deleteReminder(ctx, id);
  }

  /** خلاصه‌ی داشبورد — هر بخش فقط اگر کاربر مجوز مشاهده‌ی ماژول مربوطه را دارد پر می‌شود (بقیه خالی/صفر). */
  @Get('summary')
  async summary(@Ctx() ctx: TenantRequestContext) {
    const [data, acl] = await Promise.all([this.dashboard.summary(ctx), this.permissions.effectiveMatrix(ctx)]);
    if (acl.manager) return data;
    const can = (code: string) => !!acl.modules[code] && (acl.modules[code].canViewAll || acl.modules[code].canViewOwn);
    return {
      ...data,
      cashBalance: can('accounting') ? data.cashBalance : 0,
      checksDueSoon: can('accounting') ? data.checksDueSoon : { total: 0, count: 0, items: [] },
      monthInvoiceCount: can('sales') ? data.monthInvoiceCount : 0,
      overdueReceivables: can('sales') ? data.overdueReceivables : { total: 0, count: 0, items: [] },
      dueOrOverdueInvoices: can('sales') ? data.dueOrOverdueInvoices : [],
      salesTrend: can('sales') ? data.salesTrend : data.salesTrend.map((p) => ({ ...p, value: 0 })),
      customerFollowUps: can('sales') || can('crm') ? data.customerFollowUps : [],
      lowStockCount: can('warehouse') ? data.lowStockCount : 0,
      producibleCapacity: can('production') || can('warehouse') ? data.producibleCapacity : [],
      productionTrend: can('production') ? data.productionTrend : data.productionTrend.map((p) => ({ ...p, value: 0, valueLastYear: 0 })),
    };
  }

  /** یادآوری پیامکی دستی برای یک فاکتور مشخص — از ردیف ویجت فاکتورهای نزدیک به سررسید/معوق داشبورد. */
  @Post('overdue-invoices/:invoiceId/remind-sms')
  async remindSms(@Param('invoiceId') invoiceId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'sales');
    return this.dueReminders.remindSms(ctx, invoiceId);
  }

  /** ثبت پیگیری تلفنی برای یک فاکتور — چه گفته/قول داده شد و واکنش مشتری. */
  @Post('overdue-invoices/:invoiceId/follow-up')
  async createFollowUp(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateInvoiceFollowUpDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'sales');
    return this.dueReminders.createFollowUp(ctx, invoiceId, dto);
  }

  /** تاریخچه‌ی پیگیری‌های تلفنی یک فاکتور مشخص. */
  @Get('overdue-invoices/:invoiceId/follow-ups')
  async listFollowUps(@Param('invoiceId') invoiceId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'sales');
    return this.dueReminders.listFollowUps(ctx, invoiceId);
  }
}
