import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { jalaliMonthGregorianRange, jalaliMonthLength, toJalaliDate } from '../common/jalali.js';
import { iranHolidaysForYear } from '../booking/iran-holidays.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateDashboardReminderDto } from './dto/create-dashboard-reminder.dto.js';

export type CalendarEventType =
  | 'birthday-employee'
  | 'birthday-contact'
  | 'task'
  | 'interview'
  | 'mentoring-session'
  | 'invoice-due'
  | 'check-due'
  | 'contract-end'
  | 'reminder';

export type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  title: string;
  link: string | null;
};

/**
 * دسترسی کاربر به هر نوع رویداد تقویم: `all` = همه‌ی رکوردها، `own` = فقط رکوردهای
 * مربوط به خودش، `none` = اصلاً نمایش داده نشود. تقویم نباید از سطح دسترسی ماژول‌ها
 * بزرگ‌تر باشد (پیش‌تر هر کسی کارهای همه‌ی همکاران را می‌دید).
 */
export type CalendarScope = 'all' | 'own' | 'none';
export type CalendarAccess = {
  userId: string | null;
  scope: Record<Exclude<CalendarEventType, 'reminder'>, CalendarScope>;
};

export type CalendarDay = {
  day: number;
  isFriday: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  hasBirthday: boolean;
  events: CalendarEvent[];
};

/**
 * تجمیع رویدادهای تقویم ماهانه‌ی داشبورد از حدود هفت جدول مختلف — هر کدام
 * یک کوئری Prisma محدود به بازه‌ی میلادیِ معادل ماه شمسی درخواستی، به‌جز
 * تولدها که سالانه تکرار می‌شوند و بر اساس ماه/روز شمسیِ خودِ birthDate
 * فیلتر می‌شوند (نه بازه‌ی سال جاری).
 */
@Injectable()
export class DashboardCalendarService {
  async monthCalendar(ctx: TenantRequestContext, jalaliYear: number, jalaliMonth: number, access: CalendarAccess) {
    const me = access.userId;
    const sc = access.scope;
    // کاربری که شناسه‌ی محلی ندارد نمی‌تواند «رکورد خودش» داشته باشد -> هیچ‌چیز نشان داده نمی‌شود.
    const gate = <T,>(kind: keyof CalendarAccess['scope'], ownWhere: Record<string, unknown>, run: (where: Record<string, unknown>) => Promise<T[]>): Promise<T[]> => {
      if (sc[kind] === 'none') return Promise.resolve([]);
      if (sc[kind] === 'own') return me ? run(ownWhere) : Promise.resolve([]);
      return run({});
    };
    const monthLength = jalaliMonthLength(jalaliYear, jalaliMonth);
    const { start, end } = jalaliMonthGregorianRange(jalaliYear, jalaliMonth);

    const monthHolidays = iranHolidaysForYear(jalaliYear).filter((h) => h.month === jalaliMonth);
    const days = new Map<number, CalendarDay>();
    for (let d = 1; d <= monthLength; d++) {
      const holiday = monthHolidays.find((h) => h.day === d)?.name ?? null;
      const gDate = addDaysFromMonthStart(start, jalaliYear, jalaliMonth, d);
      days.set(d, {
        day: d,
        isFriday: gDate.getDay() === 5,
        isHoliday: !!holiday,
        holidayName: holiday,
        hasBirthday: false,
        events: [],
      });
    }

    function push(day: number, event: CalendarEvent) {
      const bucket = days.get(day);
      if (!bucket) return;
      bucket.events.push(event);
      if (event.type === 'birthday-employee' || event.type === 'birthday-contact') bucket.hasBirthday = true;
    }

    const [
      employeesWithBirthday,
      contactsWithBirthday,
      tasks,
      interviews,
      mentoringSessions,
      invoices,
      checks,
      contracts,
      reminders,
    ] = await Promise.all([
      gate('birthday-employee', { userId: me }, (w) => ctx.tenantDb.employee.findMany({ where: { birthDate: { not: null }, ...w }, select: { id: true, fullName: true, birthDate: true } })),
      gate('birthday-contact', { ownerUserId: me }, (w) => ctx.tenantDb.crmContact.findMany({ where: { birthDate: { not: null }, ...w }, select: { id: true, name: true, company: true, birthDate: true } })),
      gate('task', { assignedUserId: me }, (w) => ctx.tenantDb.task.findMany({ where: { dueAt: { gte: start, lt: end }, ...w }, select: { id: true, title: true, dueAt: true } })),
      gate('interview', { interviewerUserId: me }, (w) =>
        ctx.tenantDb.jobInterview.findMany({
          where: { scheduledAt: { gte: start, lt: end }, ...w },
          select: { id: true, scheduledAt: true, applicant: { select: { name: true } } },
        }),
      ),
      gate('mentoring-session', { engagement: { advisorUserId: me } }, (w) =>
        ctx.tenantDb.mentoringSession.findMany({
          where: { scheduledAt: { gte: start, lt: end }, ...w },
          select: { id: true, scheduledAt: true, engagement: { select: { contact: { select: { name: true } } } } },
        }),
      ),
      gate('invoice-due', { createdByUserId: me }, (w) =>
        ctx.tenantDb.salesInvoice.findMany({
          where: { dueAt: { gte: start, lt: end }, ...w },
          select: { id: true, invoiceNo: true, dueAt: true },
        }),
      ),
      gate('check-due', { createdByUserId: me }, (w) =>
        ctx.tenantDb.check.findMany({
          where: { dueDate: { gte: start, lt: end }, ...w },
          select: { id: true, sayadId: true, dueDate: true },
        }),
      ),
      gate('contract-end', { createdByUserId: me }, (w) =>
        ctx.tenantDb.contract.findMany({
          where: { endDate: { gte: start, lt: end }, ...w },
          select: { id: true, contractNo: true, endDate: true },
        }),
      ),
      ctx.tenantDb.dashboardReminder.findMany({
        // یادآوری دستی شخصی است: هر کس فقط یادآوری‌های خودش را می‌بیند (حتی مدیر).
        where: { date: { gte: start, lt: end }, createdByUserId: me ?? '__none__' },
        select: { id: true, title: true, note: true, date: true },
      }),
    ]);

    for (const e of employeesWithBirthday) {
      const { month, day } = toJalaliDate(e.birthDate!);
      if (month !== jalaliMonth) continue;
      push(clampDay(day, monthLength), { id: e.id, type: 'birthday-employee', title: `تولد ${e.fullName}`, link: '/hr' });
    }
    for (const c of contactsWithBirthday) {
      const { month, day } = toJalaliDate(c.birthDate!);
      if (month !== jalaliMonth) continue;
      push(clampDay(day, monthLength), {
        id: c.id,
        type: 'birthday-contact',
        title: `تولد ${c.company || c.name}`,
        link: '/crm',
      });
    }
    for (const t of tasks) {
      const { day } = toJalaliDate(t.dueAt!);
      push(day, { id: t.id, type: 'task', title: t.title, link: '/tasks' });
    }
    for (const i of interviews) {
      const { day } = toJalaliDate(i.scheduledAt);
      push(day, { id: i.id, type: 'interview', title: `مصاحبه با ${i.applicant.name}`, link: '/recruitment' });
    }
    for (const s of mentoringSessions) {
      const { day } = toJalaliDate(s.scheduledAt);
      push(day, {
        id: s.id,
        type: 'mentoring-session',
        title: `جلسه با ${s.engagement.contact.name}`,
        link: '/mentoring',
      });
    }
    for (const inv of invoices) {
      const { day } = toJalaliDate(inv.dueAt!);
      push(day, { id: inv.id, type: 'invoice-due', title: `سررسید فاکتور #${inv.invoiceNo}`, link: '/sales' });
    }
    for (const c of checks) {
      const { day } = toJalaliDate(c.dueDate);
      push(day, { id: c.id, type: 'check-due', title: `سررسید چک ${c.sayadId}`, link: '/checks' });
    }
    for (const c of contracts) {
      const { day } = toJalaliDate(c.endDate);
      push(day, { id: c.id, type: 'contract-end', title: `پایان قرارداد #${c.contractNo}`, link: '/contracts' });
    }
    for (const r of reminders) {
      const { day } = toJalaliDate(r.date);
      push(day, { id: r.id, type: 'reminder', title: r.title, link: null });
    }

    return {
      year: jalaliYear,
      month: jalaliMonth,
      monthLength,
      days: Array.from(days.values()).sort((a, b) => a.day - b.day),
    };
  }

  async createReminder(ctx: TenantRequestContext, dto: CreateDashboardReminderDto) {
    const createdByUserId = await resolveTenantUserId(ctx);
    // فقط بخش تاریخ معنا دارد — مثل بقیه‌ی فیلدهای date-only این پروژه، ساعت صفر ذخیره می‌شود.
    const date = new Date(`${dto.date.slice(0, 10)}T00:00:00`);
    return ctx.tenantDb.dashboardReminder.create({
      data: { date, title: dto.title.trim(), note: dto.note?.trim() || null, createdByUserId },
    });
  }

  async deleteReminder(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.dashboardReminder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('یادآوری یافت نشد');
    const me = await resolveTenantUserId(ctx).catch(() => null);
    if (existing.createdByUserId !== me) throw new NotFoundException('یادآوری یافت نشد');
    await ctx.tenantDb.dashboardReminder.delete({ where: { id } });
    return { ok: true };
  }
}

/** روز n اُم ماه شمسی را از تاریخ میلادیِ روز اول همان ماه محاسبه می‌کند (بدون تبدیل دوباره‌ی هر روز). */
function addDaysFromMonthStart(monthStartGregorian: Date, _jy: number, _jm: number, day: number): Date {
  const d = new Date(monthStartGregorian);
  d.setDate(d.getDate() + (day - 1));
  return d;
}

/** روزهای اسفندِ کبیسه (۳۰ام) در سالی که آن ماه ۲۹ روزه است را به آخرین روز واقعی محدود می‌کند. */
function clampDay(day: number, monthLength: number): number {
  return Math.min(day, monthLength);
}
