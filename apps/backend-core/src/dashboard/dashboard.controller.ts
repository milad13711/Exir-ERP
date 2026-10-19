import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { assertInScope } from '../permissions/scope.util.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardCalendarService, type CalendarAccess, type CalendarEvent, type CalendarScope } from './dashboard-calendar.service.js';
import { InvoiceDueRemindersService } from './invoice-due-reminders.service.js';
import { CreateInvoiceFollowUpDto } from './dto/create-invoice-follow-up.dto.js';
import { CreateDashboardReminderDto, SnoozeDashboardReminderDto, UpdateDashboardReminderDto } from './dto/create-dashboard-reminder.dto.js';
import { DashboardRemindersService } from './dashboard-reminders.service.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';

// نوع رویداد تقویم -> کد ماژولی که مجوز مشاهده‌اش (همه/فقط خودم) را کنترل می‌کند.
// یادآوری دستی شخصی است و جدا (فقط برای سازنده) مدیریت می‌شود.
const CALENDAR_EVENT_MODULE: Record<Exclude<CalendarEvent['type'], 'reminder'>, string> = {
  'birthday-employee': 'hr',
  'birthday-contact': 'crm',
  task: 'tasks',
  interview: 'recruitment',
  'mentoring-session': 'mentoring',
  'invoice-due': 'sales',
  'check-due': 'accounting',
  'contract-end': 'contracts',
};

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly calendar: DashboardCalendarService,
    private readonly permissions: PermissionsService,
    private readonly dueReminders: InvoiceDueRemindersService,
    private readonly reminders: DashboardRemindersService,
    private readonly layout: DashboardLayoutService,
  ) {}

  /** فاکتور باید در دامنه‌ی «فقط خودم/همه»ی ماژول فروش کاربر باشد؛ خارج از دامنه = ۴۰۴. */
  private async assertInvoiceInScope(ctx: TenantRequestContext, invoiceId: string): Promise<void> {
    const scope = await this.permissions.viewScope(ctx, 'sales', 'createdByUserId');
    await assertInScope(ctx.tenantDb.salesInvoice, scope, { id: invoiceId }, { message: 'فاکتور یافت نشد' });
  }

  /** چیدمان مؤثر داشبورد همین کاربر (شرکت + شخصی‌سازی) — فقط ویجت‌های نصب‌شده و مجاز. */
  @Get('layout')
  async myLayout(@Ctx() ctx: TenantRequestContext) {
    return this.layout.resolveForUser(ctx);
  }

  /** شخصی‌سازی کاربر: پنهان‌کردن + ترتیب (هرگز ویجت جدید اضافه نمی‌کند). */
  @Put('layout/me')
  async saveMyLayout(@Body() body: unknown, @Ctx() ctx: TenantRequestContext) {
    return this.layout.saveMine(ctx, body);
  }

  /** «بازنشانی به پیش‌فرض» برای شخصی‌سازی خود کاربر. */
  @Delete('layout/me')
  async resetMyLayout(@Ctx() ctx: TenantRequestContext) {
    return this.layout.resetMine(ctx);
  }

  /** فقط مدیر: تنظیم فعلی شرکت (همه‌ی ویجت‌های ماژول‌های نصب‌شده). */
  @Get('layout/company')
  async companyLayout(@Ctx() ctx: TenantRequestContext) {
    return this.layout.companyConfig(ctx);
  }

  @Put('layout/company')
  async saveCompanyLayout(@Body() body: unknown, @Ctx() ctx: TenantRequestContext) {
    return this.layout.saveCompany(ctx, body);
  }

  @Delete('layout/company')
  async resetCompanyLayout(@Ctx() ctx: TenantRequestContext) {
    return this.layout.resetCompany(ctx);
  }

  /** تقویم ماهانه‌ی داشبورد — تولد/وظیفه/مصاحبه/جلسه/سررسید فاکتور و چک/پایان قرارداد/یادآوری دستی، به تفکیک روز. */
  @Get('calendar')
  async monthCalendar(@Query('year') year: string, @Query('month') month: string, @Ctx() ctx: TenantRequestContext) {
    const [acl, userId] = await Promise.all([
      this.permissions.effectiveMatrix(ctx),
      resolveTenantUserId(ctx).catch(() => null),
    ]);
    const scopeFor = (code: string): CalendarScope => {
      if (acl.manager) return 'all';
      const m = acl.modules[code];
      if (!m) return 'none';
      return m.canViewAll ? 'all' : m.canViewOwn ? 'own' : 'none';
    };
    const scope = Object.fromEntries(
      Object.entries(CALENDAR_EVENT_MODULE).map(([type, code]) => [type, scopeFor(code)]),
    ) as CalendarAccess['scope'];
    return this.calendar.monthCalendar(ctx, Number(year), Number(month), { userId, scope });
  }

  /** ایجاد یادآوری شخصی با ساعت مشخص، پیش‌هشدار و تکرار. */
  @Post('reminders')
  async createReminder(@Body() dto: CreateDashboardReminderDto, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.create(ctx, dto);
  }

  /** آلارم‌های فعال (سررسیدشده و انجام‌نشده) برای پاپ‌آپ داخل برنامه — فقط یادآوری‌های خودِ کاربر. */
  @Get('reminders/active')
  async activeReminders(@Ctx() ctx: TenantRequestContext) {
    return this.reminders.active(ctx);
  }

  @Patch('reminders/:id')
  async updateReminder(@Param('id') id: string, @Body() dto: UpdateDashboardReminderDto, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.update(ctx, id, dto);
  }

  @Post('reminders/:id/done')
  async doneReminder(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.markDone(ctx, id);
  }

  @Post('reminders/:id/reopen')
  async reopenReminder(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.reopen(ctx, id);
  }

  @Post('reminders/:id/snooze')
  async snoozeReminder(@Param('id') id: string, @Body() dto: SnoozeDashboardReminderDto, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.snooze(ctx, id, dto.minutes);
  }

  /** حذف یک یادآوری شخصی. */
  @Delete('reminders/:id')
  async deleteReminder(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.reminders.remove(ctx, id);
  }

  /** خلاصه‌ی داشبورد — هر بخش فقط اگر کاربر مجوز مشاهده‌ی ماژول مربوطه را دارد پر می‌شود (بقیه خالی/صفر). */
  @Get('summary')
  async summary(@Ctx() ctx: TenantRequestContext) {
    const [data, acl] = await Promise.all([this.dashboard.summary(ctx), this.permissions.effectiveMatrix(ctx)]);
    if (acl.manager) return data;
    // این خلاصه جمع‌های کل شرکت است (موجودی نقد، فاکتورها، چک‌ها، موجودی انبار)؛ قابل تفکیک به «فقط خودم» نیست،
    // پس فقط «مشاهده‌ی همه» آن را می‌بیند — کاربر «فقط خودم» نباید با داشبورد آمار کل شرکت را ببیند.
    const can = (code: string) => !!acl.modules[code]?.canViewAll;
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
    await this.assertInvoiceInScope(ctx, invoiceId);
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
    await this.assertInvoiceInScope(ctx, invoiceId);
    return this.dueReminders.createFollowUp(ctx, invoiceId, dto);
  }

  /** تاریخچه‌ی پیگیری‌های تلفنی یک فاکتور مشخص. */
  @Get('overdue-invoices/:invoiceId/follow-ups')
  async listFollowUps(@Param('invoiceId') invoiceId: string, @Ctx() ctx: TenantRequestContext) {
    await this.assertInvoiceInScope(ctx, invoiceId);
    return this.dueReminders.listFollowUps(ctx, invoiceId);
  }
}
