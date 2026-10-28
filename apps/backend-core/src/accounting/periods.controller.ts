import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { LockPeriodDto, UnlockPeriodDto } from './dto/period-lock.dto.js';
import { auditAccounting } from './journal-posting.js';
import { getFiscalStartMonth, setFiscalStartMonth } from './periods/accounting-settings.js';
import {
  currentJalaliMonth,
  fiscalYearMonths,
  fiscalYearOf,
  jalaliMonthRange,
  monthLabel,
  normalizeStartMonth,
  parsePeriodKey,
  periodKey,
} from './periods/jalali-periods.js';

/**
 * دوره‌های مالی: فهرست ماه‌های سال مالی با وضعیت قفل، قفل/بازکردن ماه («بستن ماه») و تنظیم ماه شروع سال مالی.
 * قفل/بازکردن فقط برای مالک/مدیر و با دسترسی ویرایش حسابداری؛ هر دو در ActivityLog ثبت می‌شوند.
 */
@Controller('accounting/periods')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('accounting')
export class PeriodsController {
  constructor(private readonly permissions: PermissionsService) {}

  private assertManager(ctx: TenantRequestContext): void {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('فقط مالک یا مدیر می‌تواند ماه مالی را ببندد یا باز کند');
  }

  @Get()
  async list(@Query('fiscalYear') fiscalYear: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'accounting');
    const startMonth = await getFiscalStartMonth(ctx.tenantDb);
    const now = new Date();
    const currentFy = fiscalYearOf(now, startMonth);
    let fy = currentFy;
    if (fiscalYear) {
      fy = Number(fiscalYear);
      if (!Number.isInteger(fy) || fy < 1300 || fy > 1600) throw new BadRequestException('سال مالی نامعتبر است');
    }
    const months = fiscalYearMonths(fy, startMonth);
    const locks = await ctx.tenantDb.accountingPeriodLock.findMany({ where: { periodKey: { in: months.map((m) => m.key) } } });
    const lockByKey = new Map(locks.map((l) => [l.periodKey, l]));
    const first = await ctx.tenantDb.journalEntry.aggregate({ _min: { date: true } });
    const firstFy = first._min.date ? fiscalYearOf(first._min.date, startMonth) : currentFy;
    const fiscalYears: number[] = [];
    for (let y = Math.min(firstFy, fy); y <= Math.max(currentFy, fy); y += 1) fiscalYears.push(y);
    const cur = currentJalaliMonth(now);
    return {
      startMonth,
      fiscalYear: fy,
      currentFiscalYear: currentFy,
      currentKey: periodKey(cur.year, cur.month),
      fiscalYears,
      months: months.map((m) => {
        const l = lockByKey.get(m.key);
        return {
          key: m.key,
          year: m.year,
          month: m.month,
          label: m.label,
          days: m.days,
          from: m.from,
          to: new Date(m.toExclusive.getTime() - 1),
          locked: !!l?.isLocked,
          lockedAt: l?.isLocked ? l.lockedAt : null,
          lockNote: l?.isLocked ? l.lockNote : null,
        };
      }),
    };
  }

  @Put('settings')
  async updateSettings(@Body() dto: { startMonth?: number }, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    this.assertManager(ctx);
    const sm = Number(dto?.startMonth);
    if (!Number.isInteger(sm) || sm < 1 || sm > 12) throw new BadRequestException('ماه شروع سال مالی باید بین ۱ تا ۱۲ باشد');
    const before = await getFiscalStartMonth(ctx.tenantDb);
    const saved = await setFiscalStartMonth(ctx.tenantDb, normalizeStartMonth(sm));
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    await auditAccounting(ctx, userId, 'accounting.fiscal.start_month_changed', 'ModuleSetting', null, { before, after: saved }, 'ماه شروع سال مالی تغییر کرد');
    return { startMonth: saved };
  }

  @Post(':key/lock')
  async lock(@Param('key') key: string, @Body() dto: LockPeriodDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    this.assertManager(ctx);
    const { year, month } = parsePeriodKey(key);
    const k = periodKey(year, month);
    const r = jalaliMonthRange(year, month);
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const drafts = await ctx.tenantDb.journalEntry.count({ where: { status: 'DRAFT', date: { gte: r.from, lt: r.toExclusive } } });
    const note = dto?.note?.trim() || null;
    const row = await ctx.tenantDb.accountingPeriodLock.upsert({
      where: { periodKey: k },
      create: { periodKey: k, fromDate: r.from, toDate: r.toExclusive, isLocked: true, lockedByUserId: userId, lockNote: note },
      update: { isLocked: true, lockedAt: new Date(), lockedByUserId: userId, lockNote: note, unlockedAt: null, unlockedByUserId: null, unlockReason: null },
    });
    await auditAccounting(ctx, userId, 'accounting.period.locked', 'AccountingPeriodLock', row.id, { periodKey: k, draftsInPeriod: drafts, note }, `ماه ${monthLabel(year, month)} بسته شد`);
    return { key: k, locked: true, draftsInPeriod: drafts };
  }

  @Post(':key/unlock')
  async unlock(@Param('key') key: string, @Body() dto: UnlockPeriodDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'accounting');
    this.assertManager(ctx);
    const reason = (dto?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('دلیل بازکردن ماه را بنویسید');
    const { year, month } = parsePeriodKey(key);
    const k = periodKey(year, month);
    const existing = await ctx.tenantDb.accountingPeriodLock.findUnique({ where: { periodKey: k } });
    if (!existing || !existing.isLocked) throw new BadRequestException('این ماه قفل نیست');
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    await ctx.tenantDb.accountingPeriodLock.update({
      where: { periodKey: k },
      data: { isLocked: false, unlockedAt: new Date(), unlockedByUserId: userId, unlockReason: reason },
    });
    await auditAccounting(ctx, userId, 'accounting.period.unlocked', 'AccountingPeriodLock', existing.id, { periodKey: k, reason }, `قفل ماه ${monthLabel(year, month)} باز شد`);
    return { key: k, locked: false };
  }
}

