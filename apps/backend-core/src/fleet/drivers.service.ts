import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateDriverDto } from './dto/create-driver.dto.js';
import type { UpdateDriverDto } from './dto/update-driver.dto.js';

@Injectable()
export class DriversService {
  list(ctx: TenantRequestContext, filters: { isActive?: boolean }) {
    return ctx.tenantDb.driver.findMany({
      where: filters.isActive === undefined ? {} : { isActive: filters.isActive },
      orderBy: { name: 'asc' },
    });
  }

  /** میانگین امتیازی که راننده از نظرسنجی‌های بارهای تحویل‌شده‌اش گرفته — همیشه زنده محاسبه می‌شود، هرگز ذخیره نمی‌شود. */
  async averageRating(ctx: TenantRequestContext, driverId: string): Promise<number | null> {
    const surveys = await ctx.tenantDb.deliverySurvey.findMany({
      where: { shipment: { driverId }, driverRating: { not: null } },
      select: { driverRating: true },
    });
    if (surveys.length === 0) return null;
    const sum = surveys.reduce((acc, s) => acc + (s.driverRating ?? 0), 0);
    return Math.round((sum / surveys.length) * 10) / 10;
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const driver = await ctx.tenantDb.driver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException('راننده یافت نشد');
    const averageRating = await this.averageRating(ctx, id);
    return { ...driver, averageRating };
  }

  create(ctx: TenantRequestContext, dto: CreateDriverDto) {
    return ctx.tenantDb.driver.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        vehicleType: dto.vehicleType,
        plateNumber: dto.plateNumber,
        capacityKg: dto.capacityKg,
        serviceAreas: dto.serviceAreas ?? [],
        availableHoursNote: dto.availableHoursNote,
        reliabilityNote: dto.reliabilityNote,
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateDriverDto) {
    const existing = await ctx.tenantDb.driver.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('راننده یافت نشد');
    return ctx.tenantDb.driver.update({ where: { id }, data: dto });
  }

  /** بدون حذف واقعی — سوابق بار/پیشنهاد به این راننده وابسته است، مثل الگوی Product.isActive. */
  async deactivate(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.driver.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('راننده یافت نشد');
    return ctx.tenantDb.driver.update({ where: { id }, data: { isActive: false } });
  }
}
