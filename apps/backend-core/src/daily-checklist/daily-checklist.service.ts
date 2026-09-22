import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getVisibleEmployeeIds } from '../hr/org-chain.util.js';
import { ReportsService } from '../reports/reports.service.js';
import { faDate } from '../common/persian.js';
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
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(ctx: TenantRequestContext, dto: CreateChecklistItemDto) {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = dto.forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);
    const last = await ctx.tenantDb.dailyChecklistItem.findFirst({
      where: { userId: targetUserId, date: dayOnly(dto.date) },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return ctx.tenantDb.dailyChecklistItem.create({
      data: {
        userId: targetUserId,
        date: dayOnly(dto.date),
        title: dto.title.trim(),
        description: dto.description?.trim() || undefined,
        createdByUserId: myUserId,
        order: (last?.order ?? -1) + 1,
      },
      include: ITEM_INCLUDE,
    });
  }

  private async findOwned(ctx: TenantRequestContext, id: string, myUserId: string) {
    const item = await ctx.tenantDb.dailyChecklistItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('این مورد یافت نشد');
    await this.assertCanActFor(ctx, item.userId, myUserId);
    return item;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateChecklistItemDto) {
    const myUserId = await this.requireUserId(ctx);
    await this.findOwned(ctx, id, myUserId);
    return ctx.tenantDb.dailyChecklistItem.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description !== undefined ? dto.description.trim() || null : undefined,
        done: dto.done,
        doneAt: dto.done === undefined ? undefined : dto.done ? new Date() : null,
      },
      include: ITEM_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    const myUserId = await this.requireUserId(ctx);
    await this.findOwned(ctx, id, myUserId);
    await ctx.tenantDb.dailyChecklistItem.delete({ where: { id } });
    return { success: true };
  }

  /** روی همین آیتم یک وظیفه‌ی واقعی (ماژول وظایف) می‌سازد و به خودِ آیتم وصلش می‌کند. */
  async createTask(ctx: TenantRequestContext, id: string, dto: CreateChecklistTaskDto) {
    const myUserId = await this.requireUserId(ctx);
    const item = await this.findOwned(ctx, id, myUserId);
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

  /** تجمیع چک‌لیست یک روز به یک گزارش واقعی در ماژول گزارش‌ها. */
  async generateReport(ctx: TenantRequestContext, dto: GenerateChecklistReportDto) {
    const myUserId = await this.requireUserId(ctx);
    const targetUserId = dto.forUserId || myUserId;
    await this.assertCanActFor(ctx, targetUserId, myUserId);

    const date = dayOnly(dto.date);
    const items = await ctx.tenantDb.dailyChecklistItem.findMany({ where: { userId: targetUserId, date }, orderBy: { order: 'asc' } });
    if (items.length === 0) throw new BadRequestException('چک‌لیست این روز خالی است');

    const user = await ctx.tenantDb.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    const done = items.filter((i) => i.done);
    const pending = items.filter((i) => !i.done);
    const dateFa = faDate(date);
    const renderList = (list: typeof items) =>
      list.length === 0 ? 'موردی نیست' : list.map((i) => `- ${i.title}${i.description ? ` — ${i.description}` : ''}`).join('\n');
    const body = [
      `گزارش روزانه‌ی ${user?.name ?? ''} — ${dateFa}`,
      '',
      `انجام‌شده (${done.length} از ${items.length}):`,
      renderList(done),
      '',
      'انجام‌نشده:',
      renderList(pending),
    ].join('\n');

    return this.reports.create(ctx, {
      title: `گزارش روزانه — ${dateFa}`,
      body,
      executionAt: date.toISOString(),
    });
  }
}
