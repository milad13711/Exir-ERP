import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { DailyReportSubmissionService } from '../activity/daily-report-submissions.service.js';

/**
 * نگاشت هر ماژول به مدل‌هایی که createdByUserId دارند — برای شمارش «رکوردهای
 * ایجادشده توسط این فرد». فقط ماژول‌هایی که فرد از طریق نقش‌اش به آن‌ها
 * دسترسی (مشاهده) دارد شمارش می‌شوند — یعنی این بخش از KPI واقعاً همان چیزی
 * است که در شرح وظایف/دسترسی‌های او تعریف شده، نه یک لیست ثابت برای همه.
 */
const MODULE_ACTIVITY_MODELS: Record<string, { label: string; models: (keyof import('../../generated/tenant-client/index.js').PrismaClient)[] }> = {
  sales: { label: 'فروش و فاکتور', models: ['salesInvoice', 'salesQuotation', 'salesReturn', 'recurringInvoiceTemplate'] },
  purchasing: { label: 'خرید و تأمین‌کننده', models: ['purchaseOrder', 'purchaseReturn'] },
  checks: { label: 'چک‌ها', models: ['check'] },
  accounting: { label: 'حسابداری', models: ['journalEntry', 'bankStatementLine', 'budget', 'fixedAsset', 'partyTransaction'] },
  warehouse: { label: 'انبار و کالا', models: ['stockMovement'] },
  production: { label: 'تولید', models: ['billOfMaterial', 'productionOrder'] },
  automation: { label: 'اتوماسیون', models: ['automationRule'] },
  booking: { label: 'رزرو نوبت', models: ['appointment'] },
  contracts: { label: 'مدیریت قرارداد', models: ['contractTemplate', 'contract', 'contractAmendment'] },
  projects: { label: 'مدیریت پروژه', models: ['project'] },
  fleet: { label: 'ناوگان حمل و نقل', models: ['shipment'] },
  mentoring: { label: 'منتورینگ و مشاوره', models: ['mentoringEngagement', 'mentoringSession'] },
  marketing: { label: 'بازاریابی', models: ['marketingCampaign'] },
  events: { label: 'رویداد و بلیط‌فروشی', models: ['event'] },
  forms: { label: 'فرم‌ساز', models: ['form'] },
  warranty: { label: 'گارانتی', models: ['warrantyCode'] },
  'qr-code': { label: 'کد QR', models: ['qrCode'] },
  recruitment: { label: 'استخدام و جذب نیرو', models: ['jobPosting'] },
  reports: { label: 'گزارش‌ها', models: ['report'] },
};

function defaultPeriod(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(to) : now;
  return { from: start, to: end };
}

@Injectable()
export class KpiService {
  constructor(private readonly dailyReports: DailyReportSubmissionService) {}

  async compute(ctx: TenantRequestContext, employeeId: string, fromParam?: string, toParam?: string) {
    const employee = await ctx.tenantDb.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('این کارمند یافت نشد');

    const { from, to } = defaultPeriod(fromParam, toParam);
    const period = { from: from.toISOString(), to: to.toISOString() };

    const [attendance, tasks, rewards, penalties, moduleActivity, dailyReports] = await Promise.all([
      this.computeAttendance(ctx, employeeId, from, to),
      employee.userId ? this.computeTasks(ctx, employee.userId, from, to) : Promise.resolve(null),
      ctx.tenantDb.personnelReward.count({ where: { employeeId, date: { gte: from, lte: to } } }),
      ctx.tenantDb.personnelPenalty.count({ where: { employeeId, date: { gte: from, lte: to } } }),
      employee.userId ? this.computeModuleActivity(ctx, employee.userId, from, to) : Promise.resolve([]),
      employee.userId ? this.computeDailyReports(ctx, employee.userId, from, to) : Promise.resolve(null),
    ]);

    const netRewardScore = rewards - penalties;
    const totalRecordsCreated = moduleActivity.reduce((sum, m) => sum + m.recordsCreated, 0);
    const overallScore = this.computeOverallScore({ attendance, tasks, netRewardScore, totalRecordsCreated });

    return {
      employee: { id: employee.id, fullName: employee.fullName, position: employee.position, employeeCode: employee.employeeCode },
      period,
      attendance,
      tasks,
      rewardsCount: rewards,
      penaltiesCount: penalties,
      netRewardScore,
      moduleActivity,
      dailyReports,
      totalRecordsCreated,
      overallScore,
    };
  }

  /** ساعت دقیق ثبت گزارش کار روزانه‌ی این فرد در بازه — دستی/خودکار و به‌موقع/با تأخیر/ثبت‌نشده. */
  private async computeDailyReports(ctx: TenantRequestContext, userId: string, from: Date, to: Date) {
    const result = await this.dailyReports.compute(ctx.tenantDb, { from: from.toISOString(), to: to.toISOString(), userIds: [userId] });
    return { cutoff: result.cutoff, range: result.range, summary: result.summary[0] ?? null, rows: result.rows.slice(0, 62) };
  }

  private async computeAttendance(ctx: TenantRequestContext, employeeId: string, from: Date, to: Date) {
    const records = await ctx.tenantDb.attendanceRecord.groupBy({
      by: ['status'],
      where: { employeeId, date: { gte: from, lte: to } },
      _count: true,
    });
    const byStatus = Object.fromEntries(records.map((r) => [r.status, r._count])) as Record<string, number>;
    const present = byStatus.PRESENT ?? 0;
    const absent = byStatus.ABSENT ?? 0;
    const leave = byStatus.LEAVE ?? 0;
    const holiday = byStatus.HOLIDAY ?? 0;
    const trackedDays = present + absent + leave;
    const rate = trackedDays > 0 ? Math.round((present / trackedDays) * 100) : null;
    return { present, absent, leave, holiday, rate };
  }

  private async computeTasks(ctx: TenantRequestContext, userId: string, from: Date, to: Date) {
    const [assigned, completed, overdue] = await Promise.all([
      ctx.tenantDb.task.count({ where: { assignedUserId: userId, createdAt: { gte: from, lte: to } } }),
      ctx.tenantDb.task.count({ where: { assignedUserId: userId, status: 'DONE', completedAt: { gte: from, lte: to } } }),
      ctx.tenantDb.task.count({ where: { assignedUserId: userId, status: 'OPEN', dueAt: { lt: new Date() } } }),
    ]);
    const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
    return { assigned, completed, overdue, completionRate };
  }

  private async computeModuleActivity(ctx: TenantRequestContext, userId: string, from: Date, to: Date) {
    const permissions = await ctx.tenantDb.modulePermission.findMany({
      where: { role: { users: { some: { userId } } }, OR: [{ canViewAll: true }, { canViewOwn: true }] },
      select: { moduleCode: true },
    });
    const accessibleCodes = new Set(permissions.map((p) => p.moduleCode));

    const results: { moduleCode: string; label: string; recordsCreated: number }[] = [];
    for (const [moduleCode, { label, models }] of Object.entries(MODULE_ACTIVITY_MODELS)) {
      if (!accessibleCodes.has(moduleCode)) continue;
      let recordsCreated = 0;
      for (const modelName of models) {
        const delegate = ctx.tenantDb[modelName] as unknown as { count: (args: unknown) => Promise<number> };
        recordsCreated += await delegate.count({ where: { createdByUserId: userId, createdAt: { gte: from, lte: to } } });
      }
      if (recordsCreated > 0) results.push({ moduleCode, label, recordsCreated });
    }
    return results.sort((a, b) => b.recordsCreated - a.recordsCreated);
  }

  /**
   * ترکیب وزنی چهار عامل استاندارد KPI: حضور، تکمیل وظایف، خالص پاداش/جریمه،
   * و حجم رکورد ایجادشده. وزن هر عامل فقط وقتی داده‌ای برایش موجود است در
   * محاسبه شرکت می‌کند و وزن‌ها دوباره به ۱۰۰ نرمال می‌شوند — تا نبود یک
   * عامل (مثلاً کارمندی که هنوز وظیفه‌ای نگرفته) نمره را مصنوعاً پایین نیاورد.
   */
  private computeOverallScore(input: {
    attendance: { rate: number | null };
    tasks: { completionRate: number | null } | null;
    netRewardScore: number;
    totalRecordsCreated: number;
  }): number | null {
    const components: { value: number; weight: number }[] = [];
    if (input.attendance.rate != null) components.push({ value: input.attendance.rate, weight: 30 });
    if (input.tasks?.completionRate != null) components.push({ value: input.tasks.completionRate, weight: 30 });
    const rewardScore = Math.max(0, Math.min(100, 50 + input.netRewardScore * 10));
    components.push({ value: rewardScore, weight: 15 });
    const activityScore = Math.min(100, input.totalRecordsCreated * 5);
    components.push({ value: activityScore, weight: 25 });

    if (components.length === 0) return null;
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const weighted = components.reduce((s, c) => s + c.value * c.weight, 0);
    return Math.round(weighted / totalWeight);
  }
}
