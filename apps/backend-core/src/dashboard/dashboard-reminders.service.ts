import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { tehranParts } from '../booking/tehran-time.js';
import type { CreateDashboardReminderDto, UpdateDashboardReminderDto } from './dto/create-dashboard-reminder.dto.js';
import { buildRemindAt, leadsAlreadyPast, normalizeLeads, SNOOZE_DEFAULT_MIN, tehranHHmm } from './reminder-logic.js';

function normalizeChannels(ch: string[] | undefined): string[] {
  const set = new Set(ch && ch.length ? ch : ['IN_APP', 'PUSH']);
  set.add('IN_APP'); // درون‌برنامه همیشه ثبت می‌شود
  return [...set];
}

/** رکورد یادآوری را به شکل ساده برای کلاینت درمی‌آورد. */
export function toReminderView(r: {
  id: string; title: string; note: string | null; remindAt: Date | null; date: Date; allDay: boolean; channels: string[];
  leadMinutes: number[]; repeatRule: string; status: string; snoozedUntil: Date | null; firedAt: Date | null;
}) {
  const at = r.snoozedUntil ?? r.remindAt ?? r.date;
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    remindAt: (r.remindAt ?? r.date).toISOString(),
    time: r.allDay ? null : tehranHHmm(r.remindAt ?? r.date),
    dateKey: tehranParts(r.remindAt ?? r.date).dateKey,
    allDay: r.allDay,
    channels: r.channels,
    leadMinutes: r.leadMinutes,
    repeatRule: r.repeatRule,
    status: r.status,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    firedAt: r.firedAt?.toISOString() ?? null,
    effectiveAt: at.toISOString(),
  };
}

/** CRUD/تعویق/انجام یادآوری‌های شخصی تقویم — هر کاربر فقط یادآوری‌های خودش را می‌بیند و تغییر می‌دهد. */
@Injectable()
export class DashboardRemindersService {
  private async me(ctx: TenantRequestContext): Promise<string> {
    const id = await resolveTenantUserId(ctx);
    if (!id) throw new NotFoundException('یادآوری یافت نشد');
    return id;
  }

  private async own(ctx: TenantRequestContext, id: string) {
    const me = await this.me(ctx);
    const row = await ctx.tenantDb.dashboardReminder.findUnique({ where: { id } });
    if (!row || row.createdByUserId !== me) throw new NotFoundException('یادآوری یافت نشد');
    return row;
  }

  private compute(dto: { date: string; time?: string; allDay?: boolean }) {
    let remindAt: Date;
    try {
      remindAt = buildRemindAt(dto.date, dto.time, !!dto.allDay);
    } catch {
      throw new BadRequestException('ساعت نامعتبر است');
    }
    return remindAt;
  }

  async create(ctx: TenantRequestContext, dto: CreateDashboardReminderDto, now = new Date()) {
    const createdByUserId = await this.me(ctx);
    const allDay = !!dto.allDay;
    const remindAt = this.compute(dto);
    const leads = normalizeLeads(dto.leadMinutes);
    const row = await ctx.tenantDb.dashboardReminder.create({
      data: {
        date: new Date(`${tehranParts(remindAt).dateKey}T00:00:00.000Z`),
        remindAt,
        allDay,
        title: dto.title.trim(),
        note: dto.note?.trim() || null,
        createdByUserId,
        channels: normalizeChannels(dto.channels),
        leadMinutes: leads,
        alertsSentMin: leadsAlreadyPast(remindAt, leads, now),
        repeatRule: dto.repeatRule ?? 'NONE',
      },
    });
    await ctx.tenantDb.dashboardReminder.update({ where: { id: row.id }, data: { seriesId: row.id } });
    return toReminderView(row);
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateDashboardReminderDto, now = new Date()) {
    const row = await this.own(ctx, id);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.note !== undefined) data.note = dto.note.trim() || null;
    if (dto.channels) data.channels = normalizeChannels(dto.channels);
    if (dto.repeatRule) data.repeatRule = dto.repeatRule;
    const timeChanged = dto.date !== undefined || dto.time !== undefined || dto.allDay !== undefined || dto.leadMinutes !== undefined;
    if (timeChanged) {
      const cur = row.remindAt ?? row.date;
      const dateKey = dto.date ?? tehranParts(cur).dateKey;
      const allDay = dto.allDay ?? row.allDay;
      const time = dto.time ?? (row.allDay ? undefined : tehranHHmm(cur));
      const remindAt = this.compute({ date: dateKey, time, allDay });
      const leads = normalizeLeads(dto.leadMinutes ?? row.leadMinutes);
      Object.assign(data, {
        remindAt,
        allDay,
        date: new Date(`${tehranParts(remindAt).dateKey}T00:00:00.000Z`),
        leadMinutes: leads,
        // زمان‌بندی تغییر کرده: آلارم‌ها از نو (به‌جز پیش‌هشدارهای از-قبل-گذشته)، تعویق لغو، دوباره فعال
        alertsSentMin: leadsAlreadyPast(remindAt, leads, now),
        snoozedUntil: null,
        firedAt: null,
        status: 'PENDING',
        doneAt: null,
      });
    }
    const updated = await ctx.tenantDb.dashboardReminder.update({ where: { id }, data });
    return toReminderView(updated);
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.own(ctx, id);
    await ctx.tenantDb.dashboardReminder.delete({ where: { id } });
    return { ok: true };
  }

  async markDone(ctx: TenantRequestContext, id: string, now = new Date()) {
    await this.own(ctx, id);
    const updated = await ctx.tenantDb.dashboardReminder.update({
      where: { id },
      data: { status: 'DONE', doneAt: now, snoozedUntil: null },
    });
    return toReminderView(updated);
  }

  async reopen(ctx: TenantRequestContext, id: string) {
    await this.own(ctx, id);
    const updated = await ctx.tenantDb.dashboardReminder.update({ where: { id }, data: { status: 'PENDING', doneAt: null } });
    return toReminderView(updated);
  }

  /** تعویق: آلارم اصلی دوباره (فقط یک‌بار) در now+N دقیقه شلیک می‌شود. */
  async snooze(ctx: TenantRequestContext, id: string, minutes?: number, now = new Date()) {
    await this.own(ctx, id);
    const m = Math.min(Math.max(Math.round(minutes ?? SNOOZE_DEFAULT_MIN), 1), 24 * 60);
    const until = new Date(now.getTime() + m * 60_000);
    const row = await ctx.tenantDb.dashboardReminder.findUnique({ where: { id } });
    const updated = await ctx.tenantDb.dashboardReminder.update({
      where: { id },
      data: {
        status: 'PENDING',
        doneAt: null,
        snoozedUntil: until,
        alertsSentMin: (row?.alertsSentMin ?? []).filter((x) => x !== 0),
      },
    });
    return toReminderView(updated);
  }

  /** آلارم‌های فعال کاربر: آلارم اصلی شلیک شده و هنوز انجام نشده (برای پاپ‌آپ داخل برنامه). */
  async active(ctx: TenantRequestContext, now = new Date()) {
    const me = await this.me(ctx);
    const since = new Date(now.getTime() - 24 * 3600_000);
    const rows = await ctx.tenantDb.dashboardReminder.findMany({
      where: {
        createdByUserId: me,
        status: 'PENDING',
        lastFiredAt: { gte: since },
        alertsSentMin: { has: 0 },
      },
      orderBy: { remindAt: 'asc' },
      take: 20,
    });
    return rows.map(toReminderView);
  }
}
