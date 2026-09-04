import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateServiceTypeDto } from './dto/create-service-type.dto.js';
import type { UpdateServiceTypeDto } from './dto/update-service-type.dto.js';

@Injectable()
export class ServiceTypesService {
  list(ctx: TenantRequestContext, includeInactive: boolean) {
    return ctx.tenantDb.serviceType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  create(ctx: TenantRequestContext, dto: CreateServiceTypeDto) {
    return ctx.tenantDb.serviceType.create({
      data: {
        name: dto.name,
        durationMinutes: dto.durationMinutes,
        price: dto.price ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateServiceTypeDto) {
    const existing = await ctx.tenantDb.serviceType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('نوع خدمت یافت نشد');
    return ctx.tenantDb.serviceType.update({ where: { id }, data: dto });
  }

  /** No hard delete — appointments reference this by a required FK, so it's deactivated instead, same pattern as Product.isActive. */
  async deactivate(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.serviceType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('نوع خدمت یافت نشد');
    const upcoming = await ctx.tenantDb.appointment.count({
      where: { serviceTypeId: id, status: { in: ['SCHEDULED', 'CONFIRMED'] }, startAt: { gte: new Date() } },
    });
    if (upcoming > 0) {
      throw new ConflictException('این نوع خدمت نوبت آینده‌ی فعال دارد و قابل غیرفعال‌سازی نیست');
    }
    return ctx.tenantDb.serviceType.update({ where: { id }, data: { isActive: false } });
  }
}
