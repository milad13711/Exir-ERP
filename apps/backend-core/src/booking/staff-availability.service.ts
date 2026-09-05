import { BadRequestException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { SaveAvailabilitySlotsDto } from './dto/save-availability-slots.dto.js';

@Injectable()
export class StaffAvailabilityService {
  /** بدون پارامتر userId یعنی وقت‌های آزاد خود کاربر لاگین‌شده. */
  async listMine(ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new BadRequestException('کاربر معتبر یافت نشد');
    return this.listForUser(ctx, userId);
  }

  listForUser(ctx: TenantRequestContext, userId: string) {
    return ctx.tenantDb.staffAvailabilitySlot.findMany({
      where: { userId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  private validateSlots(slots: SaveAvailabilitySlotsDto['slots']) {
    for (const s of slots) {
      if (s.weekday < 0 || s.weekday > 6) throw new BadRequestException('روز هفته نامعتبر است');
      if (s.startMinute < 0 || s.endMinute > 24 * 60 || s.startMinute >= s.endMinute) {
        throw new BadRequestException('بازه‌ی زمانی نامعتبر است');
      }
    }
  }

  /** جایگزینی کامل — کل الگوی هفتگی کاربر با فهرست جدید بازنویسی می‌شود. */
  async replaceMine(ctx: TenantRequestContext, dto: SaveAvailabilitySlotsDto) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new BadRequestException('کاربر معتبر یافت نشد');
    this.validateSlots(dto.slots);

    await ctx.tenantDb.staffAvailabilitySlot.deleteMany({ where: { userId } });
    if (dto.slots.length === 0) return [];
    await ctx.tenantDb.staffAvailabilitySlot.createMany({
      data: dto.slots.map((s) => ({ userId, weekday: s.weekday, startMinute: s.startMinute, endMinute: s.endMinute })),
    });
    return this.listForUser(ctx, userId);
  }

  /**
   * اگر کارشناسی هیچ اسلاتی تعریف نکرده باشد، برای سازگاری با رفتار قبلی
   * «همیشه در دسترس» فرض می‌شود — این محدودیت فقط برای کسانی فعال می‌شود که
   * صریحاً وقت‌های آزاد خودشان را مشخص کرده‌اند.
   */
  async isAvailable(ctx: TenantRequestContext, userId: string, startAt: Date, endAt: Date): Promise<boolean> {
    const slots = await ctx.tenantDb.staffAvailabilitySlot.findMany({ where: { userId } });
    if (slots.length === 0) return true;

    const weekday = startAt.getDay();
    const startMinute = startAt.getHours() * 60 + startAt.getMinutes();
    const endMinute = startMinute + (endAt.getTime() - startAt.getTime()) / 60_000;

    return slots.some((s) => s.weekday === weekday && s.startMinute <= startMinute && s.endMinute >= endMinute);
  }
}
