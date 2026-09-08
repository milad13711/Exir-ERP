import { Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

const DAY_MS = 86_400_000;

@Injectable()
export class MentoringReportsService {
  /** ویجت‌های کلی داشبورد ماژول. */
  async overview(ctx: TenantRequestContext) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekEnd = new Date(now.getTime() + 7 * DAY_MS);

    const [activeEngagements, sessionsThisMonth, upcomingSessions, goals, completedSessionsWithInvoice] = await Promise.all([
      ctx.tenantDb.mentoringEngagement.count({ where: { status: 'ACTIVE' } }),
      ctx.tenantDb.mentoringSession.count({ where: { scheduledAt: { gte: monthStart }, status: { in: ['COMPLETED', 'SCHEDULED'] } } }),
      ctx.tenantDb.mentoringSession.count({ where: { status: 'SCHEDULED', scheduledAt: { gte: now, lte: weekEnd } } }),
      ctx.tenantDb.mentoringGoal.findMany({ select: { status: true } }),
      ctx.tenantDb.mentoringSession.findMany({
        where: { status: 'COMPLETED', invoiceId: { not: null } },
        select: { invoice: { select: { total: true, issuedAt: true } } },
      }),
    ]);

    const decidedGoals = goals.filter((g) => g.status === 'ACHIEVED' || g.status === 'MISSED');
    const goalAchievementRate = decidedGoals.length > 0 ? Math.round((goals.filter((g) => g.status === 'ACHIEVED').length / decidedGoals.length) * 100) : null;

    const totalRevenue = completedSessionsWithInvoice.reduce((sum, s) => sum + (s.invoice?.total ?? 0), 0);
    const revenueThisMonth = completedSessionsWithInvoice
      .filter((s) => s.invoice && s.invoice.issuedAt >= monthStart)
      .reduce((sum, s) => sum + (s.invoice?.total ?? 0), 0);

    return {
      activeEngagements,
      sessionsThisMonth,
      upcomingSessions7d: upcomingSessions,
      goalAchievementRate,
      totalRevenue,
      revenueThisMonth,
    };
  }

  /**
   * طول عمر هر مشتری با مشاور — از تاریخ شروع اولین همکاری تا آخرین جلسه‌ی
   * ثبت‌شده (یا اکنون، اگر همکاری هنوز فعال است)، به همراه تعداد جلسات و
   * درآمد کل — برای شناسایی مشتریان بلندمدت و ریسک ریزش.
   */
  async clientLifetime(ctx: TenantRequestContext) {
    const engagements = await ctx.tenantDb.mentoringEngagement.findMany({
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        sessions: { select: { status: true, scheduledAt: true, invoice: { select: { total: true } } } },
      },
    });

    type Row = {
      contactId: string;
      contactName: string;
      contactPhone: string | null;
      firstEngagementAt: Date;
      lastSessionAt: Date | null;
      tenureDays: number;
      totalSessions: number;
      completedSessions: number;
      totalRevenue: number;
      activeEngagements: number;
      hasActiveEngagement: boolean;
    };
    const byContact = new Map<string, Row>();
    const now = new Date();

    for (const e of engagements) {
      const row =
        byContact.get(e.contactId) ??
        ({
          contactId: e.contactId,
          contactName: e.contact.name,
          contactPhone: e.contact.phone,
          firstEngagementAt: e.startDate,
          lastSessionAt: null,
          tenureDays: 0,
          totalSessions: 0,
          completedSessions: 0,
          totalRevenue: 0,
          activeEngagements: 0,
          hasActiveEngagement: false,
        } satisfies Row);

      if (e.startDate < row.firstEngagementAt) row.firstEngagementAt = e.startDate;
      if (e.status === 'ACTIVE') {
        row.activeEngagements += 1;
        row.hasActiveEngagement = true;
      }
      for (const s of e.sessions) {
        row.totalSessions += 1;
        if (s.status === 'COMPLETED') {
          row.completedSessions += 1;
          row.totalRevenue += s.invoice?.total ?? 0;
        }
        if (!row.lastSessionAt || s.scheduledAt > row.lastSessionAt) row.lastSessionAt = s.scheduledAt;
      }
      byContact.set(e.contactId, row);
    }

    return Array.from(byContact.values())
      .map((row) => {
        const referenceEnd = row.hasActiveEngagement ? now : (row.lastSessionAt ?? row.firstEngagementAt);
        row.tenureDays = Math.max(0, Math.round((referenceEnd.getTime() - row.firstEngagementAt.getTime()) / DAY_MS));
        return row;
      })
      .sort((a, b) => b.tenureDays - a.tenureDays);
  }

  /** گزارش عملکرد به تفکیک مشاور — بار مراجعه، نرخ عدم‌حضور و درآمد هر مشاور. */
  async byAdvisor(ctx: TenantRequestContext) {
    const sessions = await ctx.tenantDb.mentoringSession.findMany({
      include: { engagement: { select: { advisorUserId: true, advisor: { select: { name: true } } } }, invoice: { select: { total: true } } },
    });

    type Row = { advisorUserId: string; advisorName: string; total: number; completed: number; cancelled: number; noShow: number; revenue: number };
    const rows = new Map<string, Row>();
    for (const s of sessions) {
      const key = s.engagement.advisorUserId;
      const row = rows.get(key) ?? { advisorUserId: key, advisorName: s.engagement.advisor.name, total: 0, completed: 0, cancelled: 0, noShow: 0, revenue: 0 };
      row.total += 1;
      if (s.status === 'COMPLETED') {
        row.completed += 1;
        row.revenue += s.invoice?.total ?? 0;
      }
      if (s.status === 'CANCELLED') row.cancelled += 1;
      if (s.status === 'NO_SHOW') row.noShow += 1;
      rows.set(key, row);
    }
    return Array.from(rows.values()).sort((a, b) => b.revenue - a.revenue);
  }
}
