import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import type { UpdateAppointmentDto } from './dto/update-appointment.dto.js';

const APPOINTMENT_INCLUDE = {
  serviceType: true,
  contact: { select: { id: true, name: true, phone: true } },
  provider: { select: { id: true, name: true } },
} as const;

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

@Injectable()
export class AppointmentsService {
  constructor(private readonly automation: AutomationEngineService) {}

  list(
    ctx: TenantRequestContext,
    filters: { from?: Date; to?: Date; status?: string; providerUserId?: string },
  ) {
    return ctx.tenantDb.appointment.findMany({
      where: {
        ...(filters.from || filters.to
          ? { startAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
          : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.providerUserId ? { providerUserId: filters.providerUserId } : {}),
      },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  private async assertNoOverlap(
    ctx: TenantRequestContext,
    providerUserId: string | null | undefined,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
  ) {
    if (!providerUserId) return;
    const overlapping = await ctx.tenantDb.appointment.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        providerUserId,
        status: { in: [...ACTIVE_STATUSES] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    if (overlapping) {
      throw new ConflictException('این کارشناس در این بازه‌ی زمانی نوبت دیگری دارد');
    }
  }

  async create(ctx: TenantRequestContext, dto: CreateAppointmentDto) {
    const serviceType = await ctx.tenantDb.serviceType.findUnique({ where: { id: dto.serviceTypeId } });
    if (!serviceType || !serviceType.isActive) throw new NotFoundException('نوع خدمت یافت نشد یا غیرفعال است');

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('زمان شروع نامعتبر است');
    const endAt = new Date(startAt.getTime() + serviceType.durationMinutes * 60_000);

    await this.assertNoOverlap(ctx, dto.providerUserId, startAt, endAt);

    const createdByUserId = await resolveTenantUserId(ctx);
    const appointment = await ctx.tenantDb.appointment.create({
      data: {
        serviceTypeId: dto.serviceTypeId,
        contactId: dto.contactId,
        providerUserId: dto.providerUserId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        startAt,
        endAt,
        notes: dto.notes,
        createdByUserId,
      },
      include: APPOINTMENT_INCLUDE,
    });

    await this.automation.emit(ctx, 'booking.appointment.created', {
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      serviceName: appointment.serviceType.name,
      startAt: appointment.startAt.toISOString(),
      providerUserId: appointment.providerUserId,
    });

    return appointment;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateAppointmentDto) {
    const existing = await ctx.tenantDb.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('نوبت یافت نشد');
    if (existing.status === 'CANCELLED' || existing.status === 'COMPLETED') {
      throw new ConflictException('این نوبت دیگر قابل ویرایش نیست');
    }

    let startAt = existing.startAt;
    let endAt = existing.endAt;
    let serviceTypeId = existing.serviceTypeId;
    if (dto.serviceTypeId || dto.startAt) {
      serviceTypeId = dto.serviceTypeId ?? existing.serviceTypeId;
      const serviceType = await ctx.tenantDb.serviceType.findUnique({ where: { id: serviceTypeId } });
      if (!serviceType) throw new NotFoundException('نوع خدمت یافت نشد');
      startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
      if (Number.isNaN(startAt.getTime())) throw new BadRequestException('زمان شروع نامعتبر است');
      endAt = new Date(startAt.getTime() + serviceType.durationMinutes * 60_000);
    }

    const providerUserId = dto.providerUserId !== undefined ? dto.providerUserId : existing.providerUserId;
    await this.assertNoOverlap(ctx, providerUserId, startAt, endAt, id);

    return ctx.tenantDb.appointment.update({
      where: { id },
      data: {
        serviceTypeId,
        contactId: dto.contactId,
        providerUserId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        startAt,
        endAt,
        notes: dto.notes,
      },
      include: APPOINTMENT_INCLUDE,
    });
  }

  private async transition(
    ctx: TenantRequestContext,
    id: string,
    allowedFrom: readonly string[],
    data: Record<string, unknown>,
  ) {
    const existing = await ctx.tenantDb.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('نوبت یافت نشد');
    if (!allowedFrom.includes(existing.status)) {
      throw new ConflictException('این تغییر وضعیت برای نوبت با وضعیت فعلی مجاز نیست');
    }
    return ctx.tenantDb.appointment.update({ where: { id }, data, include: APPOINTMENT_INCLUDE });
  }

  confirm(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['SCHEDULED'], { status: 'CONFIRMED' });
  }

  complete(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED'], { status: 'COMPLETED' });
  }

  noShow(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED'], { status: 'NO_SHOW' });
  }

  async cancel(ctx: TenantRequestContext, id: string, reason: string | undefined) {
    const appointment = await this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED'], {
      status: 'CANCELLED',
      cancelReason: reason,
    });
    await this.automation.emit(ctx, 'booking.appointment.cancelled', {
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      serviceName: appointment.serviceType.name,
      startAt: appointment.startAt.toISOString(),
    });
    return appointment;
  }
}
