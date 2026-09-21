import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { isDateIranHoliday } from './iran-holidays.js';
import { fromTehran, tehranParts } from './tehran-time.js';

/** ساعت کاری پیش‌فرض برای کارشناسی که هیچ وقت آزادی تعریف نکرده: ۹ تا ۱۷، جمعه تعطیل. */
const DEFAULT_WINDOW = { startMinute: 9 * 60, endMinute: 17 * 60 };
const FRIDAY = 5;
const MIN_LEAD_MS = 30 * 60_000;

export type FreeSlot = { startAt: string; time: string; providerIds: string[] };

/**
 * وقت‌های آزاد رزرو آنلاین — مشتری فقط از همین فهرست انتخاب می‌کند، نه هر زمانی که خواست.
 * وقت آزاد = داخل بازه‌های هفتگی کارشناس (یا ساعت کاری پیش‌فرض)، غیرتعطیل، آینده، و بدون
 * تداخل با نوبت‌های فعال همان کارشناس.
 */
@Injectable()
export class BookingSlotsService {
  async listFreeSlots(
    ctx: TenantRequestContext,
    input: { serviceTypeId: string; providerUserId?: string; date: string; excludeAppointmentId?: string },
  ): Promise<FreeSlot[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new BadRequestException('تاریخ نامعتبر است');
    const serviceType = await ctx.tenantDb.serviceType.findUnique({ where: { id: input.serviceTypeId } });
    if (!serviceType) throw new NotFoundException('نوع خدمت یافت نشد');
    const duration = serviceType.durationMinutes;
    const step = Math.max(15, Math.min(duration, 30));

    const dayStart = fromTehran(input.date, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    if (isDateIranHoliday(fromTehran(input.date, 12 * 60))) return [];
    const { weekday } = tehranParts(fromTehran(input.date, 12 * 60));

    const providers = input.providerUserId
      ? [input.providerUserId]
      : (await ctx.tenantDb.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
    const candidates: Array<string | null> = providers.length > 0 ? providers : [null];

    const [slotRows, busy] = await Promise.all([
      ctx.tenantDb.staffAvailabilitySlot.findMany({ where: { userId: { in: providers } } }),
      ctx.tenantDb.appointment.findMany({
        where: {
          id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
          status: { in: ['SCHEDULED', 'CONFIRMED', 'PENDING_COORDINATION'] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { providerUserId: true, startAt: true, endAt: true },
      }),
    ]);

    const earliest = Date.now() + MIN_LEAD_MS;
    const result = new Map<number, string[]>(); // minute-of-day → providerIds

    for (const providerId of candidates) {
      const own = slotRows.filter((s) => s.userId === providerId);
      const windows =
        own.length > 0
          ? own.filter((s) => s.weekday === weekday).map((s) => ({ startMinute: s.startMinute, endMinute: s.endMinute }))
          : weekday === FRIDAY
            ? []
            : [DEFAULT_WINDOW];
      const providerBusy = busy.filter((b) => b.providerUserId === providerId);

      for (const w of windows) {
        for (let m = w.startMinute; m + duration <= w.endMinute; m += step) {
          const start = fromTehran(input.date, m);
          const end = new Date(start.getTime() + duration * 60_000);
          if (start.getTime() < earliest) continue;
          if (providerBusy.some((b) => b.startAt < end && b.endAt > start)) continue;
          const list = result.get(m) ?? [];
          list.push(providerId ?? '');
          result.set(m, list);
        }
      }
    }

    return [...result.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([m, ids]) => ({
        startAt: fromTehran(input.date, m).toISOString(),
        time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        providerIds: ids.filter(Boolean),
      }));
  }

  /** startAt واقعاً یکی از وقت‌های آزاد است؟ برای اعمال سمت سرور — کلاینت نمی‌تواند وقت دلخواه بفرستد. */
  async findSlot(ctx: TenantRequestContext, input: { serviceTypeId: string; providerUserId?: string; startAt: Date; excludeAppointmentId?: string }): Promise<FreeSlot | null> {
    const { dateKey } = tehranParts(input.startAt);
    const slots = await this.listFreeSlots(ctx, { serviceTypeId: input.serviceTypeId, providerUserId: input.providerUserId, date: dateKey, excludeAppointmentId: input.excludeAppointmentId });
    return slots.find((s) => new Date(s.startAt).getTime() === input.startAt.getTime()) ?? null;
  }
}
