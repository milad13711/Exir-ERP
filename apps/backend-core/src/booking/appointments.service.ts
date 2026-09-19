import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { faDate, faTime } from '../common/persian.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { ZarinpalService } from '../billing/zarinpal.service.js';
import { StaffAvailabilityService } from './staff-availability.service.js';
import { isDateIranHoliday } from './iran-holidays.js';
import type { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import type { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import type { ApproveCoordinationDto } from './dto/approve-coordination.dto.js';

function formatWhen(date: Date): string {
  const d = faDate(date);
  const t = faTime(date);
  return `${d} ساعت ${t}`;
}

const APPOINTMENT_INCLUDE = {
  serviceType: true,
  contact: { select: { id: true, name: true, phone: true } },
  provider: { select: { id: true, name: true, phone: true } },
} as const;

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly sms: ExirSmsService,
    private readonly zarinpal: ZarinpalService,
    private readonly staffAvailability: StaffAvailabilityService,
  ) {}

  list(
    ctx: TenantRequestContext,
    filters: { from?: Date; to?: Date; status?: string; providerUserId?: string; contactId?: string },
  ) {
    return ctx.tenantDb.appointment.findMany({
      where: {
        ...(filters.from || filters.to
          ? { startAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
          : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.providerUserId ? { providerUserId: filters.providerUserId } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
      },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startAt: 'asc' },
    });
  }

  /** برای ویجت داشبورد — نوبت‌های فعالِ هفت روز آینده. */
  upcomingThisWeek(ctx: TenantRequestContext) {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 86_400_000);
    return ctx.tenantDb.appointment.findMany({
      where: { startAt: { gte: from, lte: to }, status: { in: [...ACTIVE_STATUSES, 'PENDING_COORDINATION'] } },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startAt: 'asc' },
      take: 20,
    });
  }

  /** گزارش نوبت‌ها به تفکیک خدمت و کارشناس، در یک بازه‌ی زمانی. */
  async reportByServiceAndProvider(ctx: TenantRequestContext, from: Date, to: Date) {
    const appointments = await ctx.tenantDb.appointment.findMany({
      where: { startAt: { gte: from, lte: to } },
      include: APPOINTMENT_INCLUDE,
    });

    type Row = { key: string; serviceName: string; providerName: string; total: number; completed: number; cancelled: number; noShow: number; revenue: number };
    const rows = new Map<string, Row>();
    for (const a of appointments) {
      const providerName = a.provider?.name ?? 'بدون تخصیص';
      const key = `${a.serviceTypeId}::${a.providerUserId ?? 'none'}`;
      const row = rows.get(key) ?? {
        key,
        serviceName: a.serviceType.name,
        providerName,
        total: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        revenue: 0,
      };
      row.total += 1;
      if (a.status === 'COMPLETED') {
        row.completed += 1;
        row.revenue += a.serviceType.price;
      }
      if (a.status === 'CANCELLED') row.cancelled += 1;
      if (a.status === 'NO_SHOW') row.noShow += 1;
      rows.set(key, row);
    }
    return Array.from(rows.values()).sort((a, b) => b.total - a.total);
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
    const createdByUserId = await resolveTenantUserId(ctx);
    return this.createInternal(ctx, dto, createdByUserId, false);
  }

  /** Used by the public booking wizard, where there's no tenant User to attribute creation to. */
  createPublic(ctx: TenantRequestContext, dto: CreateAppointmentDto) {
    return this.createInternal(ctx, dto, null, true);
  }

  private async createInternal(ctx: TenantRequestContext, dto: CreateAppointmentDto, createdByUserId: string | null, isPublic: boolean) {
    const serviceType = await ctx.tenantDb.serviceType.findUnique({ where: { id: dto.serviceTypeId } });
    if (!serviceType || !serviceType.isActive) throw new NotFoundException('نوع خدمت یافت نشد یا غیرفعال است');

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('زمان شروع نامعتبر است');
    const endAt = new Date(startAt.getTime() + serviceType.durationMinutes * 60_000);

    if (isPublic) {
      if (isDateIranHoliday(startAt)) {
        throw new BadRequestException('این روز تعطیل رسمی است و امکان رزرو آنلاین ندارد');
      }
      if (dto.providerUserId && !(await this.staffAvailability.isAvailable(ctx, dto.providerUserId, startAt, endAt))) {
        throw new ConflictException('کارشناس انتخابی در این بازه‌ی زمانی وقت آزاد ندارد');
      }
    }

    await this.assertNoOverlap(ctx, dto.providerUserId, startAt, endAt);

    const needsCoordination = serviceType.requiresCoordination;
    const needsDeposit = serviceType.requiresDeposit;

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
        status: needsCoordination ? 'PENDING_COORDINATION' : 'SCHEDULED',
        paymentStatus: needsDeposit ? 'PENDING' : 'NONE',
        depositAmount: needsDeposit ? serviceType.depositAmount ?? 0 : null,
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

    if (appointment.customerPhone && this.sms.isConfigured()) {
      const message = needsCoordination
        ? `درخواست نوبت شما برای «${appointment.serviceType.name}» ثبت شد. پس از هماهنگی با کارشناس، لینک نهایی ثبت برایتان پیامک می‌شود.`
        : needsDeposit
          ? `درخواست نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} ثبت شد. برای تکمیل رزرو، بیعانه را پرداخت کنید.`
          : `درخواست نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} ثبت شد و در انتظار تأیید است.`;
      await this.sms.sendSms(appointment.customerPhone, message);
    }

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

  async confirm(ctx: TenantRequestContext, id: string) {
    const appointment = await this.transition(ctx, id, ['SCHEDULED'], { status: 'CONFIRMED' });
    if (appointment.customerPhone && this.sms.isConfigured()) {
      await this.sms.sendSms(
        appointment.customerPhone,
        `نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} تأیید شد.`,
      );
    }
    return appointment;
  }

  complete(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED'], { status: 'COMPLETED' });
  }

  noShow(ctx: TenantRequestContext, id: string) {
    return this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED'], { status: 'NO_SHOW' });
  }

  async cancel(ctx: TenantRequestContext, id: string, reason: string | undefined) {
    const appointment = await this.transition(ctx, id, ['SCHEDULED', 'CONFIRMED', 'PENDING_COORDINATION'], {
      status: 'CANCELLED',
      cancelReason: reason,
    });
    await this.automation.emit(ctx, 'booking.appointment.cancelled', {
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      serviceName: appointment.serviceType.name,
      startAt: appointment.startAt.toISOString(),
    });
    if (appointment.customerPhone && this.sms.isConfigured()) {
      await this.sms.sendSms(
        appointment.customerPhone,
        `متأسفانه نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} لغو شد.`,
      );
    }
    return appointment;
  }

  // ── هماهنگی اولیه با ارائه‌دهنده ─────────────────────────────────────────

  /** پرسنل داخلی، وقت نهایی را تأیید می‌کند — نوبت را از حالت هماهنگی خارج و برنامه‌ریزی‌شده می‌کند. */
  async approveCoordination(ctx: TenantRequestContext, id: string, dto: ApproveCoordinationDto) {
    const existing = await ctx.tenantDb.appointment.findUnique({ where: { id }, include: { serviceType: true } });
    if (!existing) throw new NotFoundException('نوبت یافت نشد');
    if (existing.status !== 'PENDING_COORDINATION') {
      throw new ConflictException('این نوبت در انتظار هماهنگی نیست');
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('زمان شروع نامعتبر است');
    const endAt = new Date(startAt.getTime() + existing.serviceType.durationMinutes * 60_000);
    const providerUserId = dto.providerUserId !== undefined ? dto.providerUserId : existing.providerUserId;

    await this.assertNoOverlap(ctx, providerUserId, startAt, endAt, id);

    const needsDeposit = existing.serviceType.requiresDeposit;
    const appointment = await ctx.tenantDb.appointment.update({
      where: { id },
      data: {
        startAt,
        endAt,
        providerUserId,
        status: 'SCHEDULED',
        coordinationRespondedAt: new Date(),
        paymentStatus: needsDeposit ? 'PENDING' : 'NONE',
        depositAmount: needsDeposit ? existing.serviceType.depositAmount ?? 0 : null,
      },
      include: APPOINTMENT_INCLUDE,
    });

    if (appointment.customerPhone && this.sms.isConfigured()) {
      const message = needsDeposit
        ? `هماهنگی نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} انجام شد. برای تکمیل رزرو، بیعانه را از طریق لینک ارسالی پرداخت کنید.`
        : `نوبت شما برای «${appointment.serviceType.name}» در تاریخ ${formatWhen(appointment.startAt)} نهایی و تأیید شد.`;
      await this.sms.sendSms(appointment.customerPhone, message);
    }

    return appointment;
  }

  async rejectCoordination(ctx: TenantRequestContext, id: string, reason: string | undefined) {
    return this.cancel(ctx, id, reason ?? 'عدم تأیید هماهنگی اولیه');
  }

  // ── بیعانه/پیش‌پرداخت آنلاین ──────────────────────────────────────────────

  async initiateDepositPayment(ctx: TenantRequestContext, id: string, callbackUrl: string) {
    const appointment = await ctx.tenantDb.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE });
    if (!appointment) throw new NotFoundException('نوبت یافت نشد');
    if (appointment.paymentStatus !== 'PENDING' || !appointment.depositAmount) {
      throw new BadRequestException('این نوبت نیاز به پرداخت بیعانه ندارد یا قبلاً پرداخت شده است');
    }

    const result = await this.zarinpal.requestPayment({
      amountToman: appointment.depositAmount,
      description: `بیعانه نوبت «${appointment.serviceType.name}» — ${appointment.customerName}`,
      callbackUrl,
      mobile: appointment.customerPhone ?? undefined,
    });
    if (!result) return null;

    await ctx.tenantDb.appointment.update({ where: { id }, data: { zarinpalAuthority: result.authority } });
    return result;
  }

  async verifyDepositPayment(ctx: TenantRequestContext, id: string, authority: string) {
    const appointment = await ctx.tenantDb.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE });
    if (!appointment) throw new NotFoundException('نوبت یافت نشد');
    if (appointment.paymentStatus === 'PAID') return { success: true as const, appointment };
    if (!appointment.depositAmount || authority !== appointment.zarinpalAuthority) {
      return { success: false as const };
    }

    const verified = await this.zarinpal.verifyPayment({ amountToman: appointment.depositAmount, authority });
    if (!verified.success) return { success: false as const };

    const updated = await ctx.tenantDb.appointment.update({
      where: { id },
      data: { paymentStatus: 'PAID', paidAt: new Date(), paymentRefId: verified.refId },
      include: APPOINTMENT_INCLUDE,
    });

    await this.automation.emit(ctx, 'booking.appointment.deposit_paid', {
      customerName: updated.customerName,
      serviceName: updated.serviceType.name,
      startAt: updated.startAt.toISOString(),
      depositAmount: updated.depositAmount,
    });

    const receiptMessage = `رسید پرداخت بیعانه نوبت «${updated.serviceType.name}» در تاریخ ${formatWhen(updated.startAt)} — کد پیگیری: ${verified.refId}`;
    if (updated.customerPhone && this.sms.isConfigured()) {
      await this.sms.sendSms(updated.customerPhone, `${receiptMessage}. نوبت شما نهایی شد.`);
    }
    if (updated.provider?.phone && this.sms.isConfigured()) {
      await this.sms.sendSms(
        updated.provider.phone,
        `بیعانه نوبت «${updated.serviceType.name}» با مشتری ${updated.customerName} در تاریخ ${formatWhen(updated.startAt)} پرداخت شد.`,
      );
    }

    return { success: true as const, appointment: updated };
  }
}
