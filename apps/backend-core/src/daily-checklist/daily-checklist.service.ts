import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getVisibleEmployeeIds } from '../hr/org-chain.util.js';
import { ReportsService } from '../reports/reports.service.js';
import { faDate } from '../common/persian.js';
import { assertEditableDay, buildDailyReportBody, todayTehran } from './checklist-day.util.js';
import { rollPendingToNextDay } from './checklist-rollover.js';
import { archiveFilesToReport, listChecklistFiles } from './checklist-report-files.js';
import type { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import type { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';
import type { CreateChecklistTaskDto } from './dto/create-checklist-task.dto.js';
import type { GenerateChecklistReportDto } from './dto/generate-report.dto.js';

const ITEM_INCLUDE = {
  task: { select: { id: true, status: true } },
} as const;

/**
 * فقط بخش تاریخ (بدون ساعت و بدون منطقه‌ی زمانی) — مستقیم از رشته‌ی «YYYY-MM-DD»
 * خوانده می‌شود تا وابسته به منطقه‌ی زمانی سرور نباشد (چک‌لیست هر روز مستقل است).
 */
function dayOnly(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new BadRequestException('تاریخ نامعتبر است');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

@Injectable()
export class DailyChecklistService {
  constructor(private readonly reports: ReportsService) {}

  /** این ماژول فقط برای کاربران واقعیِ تننت (نه کلید API) معنا دارد. */
  private async requireUserId(ctx: TenantRequestContext): Promise<string> {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new BadRequestException('این بخش فقط برای ورود با حساب کاربری در دسترس است');
    return userId;
  }

  /**
   * زیردستان قابل‌مشاهده‌ی مدیر جاری — کارمندانی که (مستقیم یا از راه زنجیره‌ی
   * مدیریتی) به این کاربر گزارش می‌دهند و خودشان هم اکانت ورود دارند.
   * OWNER/ADMIN بدون پرونده‌ی پرسنلی هم لیست کامل کارمندان دارای اکانت را می‌بینند.
   */
  async listSubordinates(ctx: TenantRequestContext) {
    const myUserId = await this.requireUserId(ctx).catch(() => null);
    const myEmployee = myUserId ? await ctx.tenantDb.employee.findUnique({ where: { userId: myUserId }, select: { id: true } }) : null;

    let employees: { id: string; fullName: string; userId: string | null }[];
    if (myEmployee) {
      const visibleIds = await getVisibleEmployeeIds(ctx.tenantDb, myEmployee.id);
      visibleIds.delete(myEmployee.id);
      employees = await ctx.tenantDb.employee.findMany({
        where: { id: { in: [...visibleIds] } },
        select: { id: true, fullName: true, userId: true },
      });
    } else if (ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN') {
      employees = await ctx.tenantDb.employee.findMany({
        where: { status: 'ACTIVE', userId: { not: null } },
        select: { id: true, fullName: true, userId: true },
      });
    } else {
      employees = [];
    }

    return employees
      .filter((e) => e.userId && e.userId !== myUserId)
      .map((e) => ({ userId: e.userId as string, name: e.fullName }));
  }

  private async assertCanActFor(ctx: TenantRequestContext, targetUserId: string, myUserId: string): Promise<void> {
    if (targetUserId === myUserId) return;
    if (ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN') return;
    const subordinates = await this.listSubordinates(ctx);
    if (!subordinates.some((s) => s.userId === targetUserId)) {
      throw new ForbiddenException('فقط چک‌لیست خودتان یا زیردستان مستقیم/غیرمستقیم‌تان قابل مشاهده یا ویرایش است');
    }
  }

  async list(ctx: TenantRequestContext, dateIso: string, forUserId?: string) {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);
    return ctx.tenantDb.dailyChecklistItem.findMany({
      where: { userId: targetUserId, date: dayOnly(dateIso) },
      include: ITEM_INCLUDE,
      // اولویت همیشه اول مرتب می‌شود (فوری، بعد متوسط، بعد عادی — همان ترتیب تعریف enum)؛
      // در هر سطح اولویت، ترتیب دستی/زمان ایجاد حفظ می‌شود.
      orderBy: [{ priority: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(ctx: TenantRequestContext, dto: CreateChecklistItemDto) {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = dto.forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);
    const date = dayOnly(dto.date);
    assertEditableDay(date);
    const last = await ctx.tenantDb.dailyChecklistItem.findFirst({
      where: { userId: targetUserId, date },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const created = await ctx.tenantDb.dailyChecklistItem.create({
      data: {
        userId: targetUserId,
        date,
        title: dto.title.trim(),
        description: dto.description?.trim() || undefined,
        createdByUserId: myUserId,
        order: (last?.order ?? -1) + 1,
        priority: dto.priority,
      },
      include: ITEM_INCLUDE,
    });
    // اگر این روز قبلاً بسته شده بود (مثلاً با ثبت زودهنگام گزارش درست بعد از نیمه‌شب —
    // دقیقاً چیزی که این باگ را لو داد: گزارش روز در دقیقه‌ی هفتمِ همان روز ثبت شد، بعد
    // آیتم‌های واقعیِ آن روز — از جمله آیتم‌های فوری — در ساعت‌های بعد اضافه شدند)، دیگر
    // هیچ جاروب خودکار/دستی‌ای این روز را دوباره نمی‌بیند چون closeDays روزهای
    // rolledOver را رد می‌کند؛ نتیجه: این آیتم تا ابد روی done:false می‌ماند و هیچ‌وقت
    // به فردا منتقل نمی‌شود. راه‌حل عمداً reset کردن کل روز نیست (چون rollPendingToNextDay
    // نسخه‌ی اصلی را حذف نمی‌کند، پس یک بستن دوباره، آیتم‌هایی که بار اول درست منتقل شده
    // بودند را دوباره تکراری می‌کرد) — به‌جایش همین یک آیتم تازه، دقیقاً با همان منطق
    // rollPendingToNextDay، مستقیماً هم روی فردا کپی می‌شود.
    const marker = await ctx.tenantDb.dailyChecklistDayClose.findUnique({ where: { userId_date: { userId: targetUserId, date } } });
    if (marker?.rolledOver) {
      const tomorrow = new Date(date.getTime() + 86_400_000);
      const lastTomorrow = await ctx.tenantDb.dailyChecklistItem.findFirst({
        where: { userId: targetUserId, date: tomorrow },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      await ctx.tenantDb.dailyChecklistItem.create({
        data: {
          userId: targetUserId,
          date: tomorrow,
          title: created.title,
          description: created.description,
          priority: created.priority,
          carriedOver: true,
          createdByUserId: created.createdByUserId,
          order: (lastTomorrow?.order ?? -1) + 1,
        },
      });
    }
    return created;
  }

  private async findOwned(ctx: TenantRequestContext, id: string, myUserId: string) {
    const item = await ctx.tenantDb.dailyChecklistItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('این مورد یافت نشد');
    await this.assertCanActFor(ctx, item.userId, myUserId);
    return item;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateChecklistItemDto) {
    const myUserId = await this.requireUserId(ctx);
    const existing = await this.findOwned(ctx, id, myUserId);
    assertEditableDay(existing.date);
    return ctx.tenantDb.dailyChecklistItem.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description !== undefined ? dto.description.trim() || null : undefined,
        done: dto.done,
        doneAt: dto.done === undefined ? undefined : dto.done ? new Date() : null,
        priority: dto.priority,
      },
      include: ITEM_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    const myUserId = await this.requireUserId(ctx);
    const existing = await this.findOwned(ctx, id, myUserId);
    assertEditableDay(existing.date);
    await ctx.tenantDb.dailyChecklistItem.delete({ where: { id } });
    return { success: true };
  }

  /** روی همین آیتم یک وظیفه‌ی واقعی (ماژول وظایف) می‌سازد و به خودِ آیتم وصلش می‌کند. */
  async createTask(ctx: TenantRequestContext, id: string, dto: CreateChecklistTaskDto) {
    const myUserId = await this.requireUserId(ctx);
    const item = await this.findOwned(ctx, id, myUserId);
    assertEditableDay(item.date);
    if (item.taskId) throw new BadRequestException('برای این مورد قبلاً وظیفه ساخته شده است');
    const task = await ctx.tenantDb.task.create({
      data: {
        title: item.title,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : item.date,
        priority: dto.priority ?? 'NORMAL',
        assignedUserId: item.userId,
        relatedModule: 'daily-checklist',
        relatedEntityId: item.id,
      },
    });
    return ctx.tenantDb.dailyChecklistItem.update({ where: { id }, data: { taskId: task.id }, include: ITEM_INCLUDE });
  }

  /** شناسه‌ی گزارشِ ثبت‌شده برای یک روز (برای نمایش فایل‌های بایگانی‌شده) — با همان قاعده‌ی دسترسیِ چک‌لیست. */
  async getDayReportId(ctx: TenantRequestContext, dateIso: string, forUserId?: string): Promise<{ reportId: string | null }> {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);
    const marker = await ctx.tenantDb.dailyChecklistDayClose.findUnique({ where: { userId_date: { userId: targetUserId, date: dayOnly(dateIso) } } });
    return { reportId: marker?.reportId ?? null };
  }

  /** تجمیع چک‌لیست یک روز به یک گزارش واقعی در ماژول گزارش‌ها. */
  async generateReport(ctx: TenantRequestContext, dto: GenerateChecklistReportDto) {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = dto.forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);

    const date = dayOnly(dto.date);
    assertEditableDay(date);
    const items = await ctx.tenantDb.dailyChecklistItem.findMany({ where: { userId: targetUserId, date }, orderBy: { order: 'asc' } });
    if (items.length === 0) throw new BadRequestException('چک‌لیست این روز خالی است');

    const user = await ctx.tenantDb.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    const dateFa = faDate(date);
    const files = await listChecklistFiles(ctx.tenantDb, items);
    const body = buildDailyReportBody(user?.name ?? '', dateFa, items, files);
    const title = `گزارش روزانه — ${dateFa}`;

    // یک روز فقط یک گزارش دارد — کلید یکتای (userId, date) روی DailyChecklistDayClose همین را تضمین می‌کند.
    // اگر قبلاً (دستی یا خودکار) برای همین روز گزارشی ثبت شده، به‌جای ساختن رکورد تکراری همان رکورد
    // به‌روزرسانی می‌شود؛ در غیر این صورت یک گزارش تازه ساخته می‌شود.
    const marker = await ctx.tenantDb.dailyChecklistDayClose.findUnique({ where: { userId_date: { userId: targetUserId, date } } });
    const report = marker?.reportId
      ? await this.reports.update(ctx, marker.reportId, { title, body, executionAt: date.toISOString() })
      : await this.reports.create(ctx, { title, body, executionAt: date.toISOString() });
    // فایل‌های پیوست‌شده‌ی آیتم‌های این روز هم در بایگانیِ همین گزارش نگه‌داری می‌شوند (idempotent).
    await archiveFilesToReport(ctx.tenantDb, report.id, files, targetUserId);

    // این روز هنوز تمام نشده (امروز یا فردا) — ثبت دستی فقط یک پیش‌نمایشِ زنده از گزارش است،
    // نه بستن نهایی روز. اگر همین‌جا rolledOver را true کنیم، جاروبِ خودکارِ آخر شب دیگر این
    // روز را نمی‌بیند و کارهایی که کاربر بعد از این کلیک اضافه می‌کند تا ابد روی done:false
    // می‌مانند (این دقیقاً همان باگ گزارش‌شده بود). بستنِ واقعی و انتقالِ کارهای مانده فقط
    // توسط DailyChecklistCronService و برای روزی که واقعاً تمام شده انجام می‌شود — همیشه یک
    // گزارش نهایی برای هر روز، همان آخر شب.
    const isDayOver = date.getTime() < todayTehran().getTime();
    if (isDayOver) {
      if (!marker?.rolledOver) await rollPendingToNextDay(ctx.tenantDb, targetUserId, date);
    }
    await ctx.tenantDb.dailyChecklistDayClose.upsert({
      where: { userId_date: { userId: targetUserId, date } },
      create: { userId: targetUserId, date, reportId: report.id, rolledOver: isDayOver },
      update: { reportId: report.id, rolledOver: isDayOver || marker?.rolledOver === true },
    });
    return report;
  }
}
