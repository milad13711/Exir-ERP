import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { faDate, faTime } from '../common/persian.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { normalizePhone } from '../voip/phone-match.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
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
  mentoringSession: { select: { id: true, engagementId: true, status: true } },
} as const;

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly sms: TenantSmsService,
    private readonly zarinpal: ZarinpalService,
    private readonly staffAvailability: StaffAvailabilityService,
  ) {}


  // ── اتصال به CRM، آدرس و پیام‌های نوبت ────────────────────────────────

  /**
   * مشتری رزرو را با شماره‌ی همراهش به مخاطبان CRM وصل می‌کند: اگر شماره از قبل
   * هست (با هر قالب +98 / 0098 / 09)، همان مخاطب؛ وگرنه مخاطب تازه ساخته می‌شود.
   */
  private async resolveContactId(ctx: TenantRequestContext, explicitContactId: string | undefined, name: string, phone: string | undefined | null) {
    if (explicitContactId) return explicitContactId;
    if (!phone) return null;
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) return null;
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone: { contains: normalized.slice(-10) } }, select: { id: true } });
    if (existing) return existing.id;
    const created = await ctx.tenantDb.crmContact.create({ data: { name, phone, source: 'رزرو نوبت' }, select: { id: true } });
    return created.id;
  }

  /** تاریخچه‌ی ارتباط با مخاطب (تب فعالیت‌ها در پروفایل CRM). */
  private async logContactHistory(ctx: TenantRequestContext, contactId: string | null | undefined, body: string, userId: string | null) {
    if (!contactId) return;
    await ctx.tenantDb.crmActivity.create({ data: { type: 'MEETING', body, contactId, userId: userId ?? undefined } });
  }

  private async resolveLocation(ctx: TenantRequestContext, appointment: { location: string | null }, serviceType: { location: string | null }): Promise<string | null> {
    if (appointment.location?.trim()) return appointment.location.trim();
    if (serviceType.location?.trim()) return serviceType.location.trim();
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'address' } } });
    const v = row?.value;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  private publicLink(ctx: TenantRequestContext, token: string): string {
    const base = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/book/${ctx.tenantSlug}/a/${token}`;
  }

  /** مبلغ قابل پرداخت هنگام رزرو: کل مبلغ خدمت یا بیعانه؛ صفر یعنی پرداختی لازم نیست. */
  private paymentTerms(serviceType: { requiresFullPayment: boolean; requiresDeposit: boolean; price: number; depositAmount: number | null }) {
    if (serviceType.requiresFullPayment && serviceType.price > 0) return { amount: serviceType.price, isFull: true };
    if (serviceType.requiresDeposit && (serviceType.depositAmount ?? 0) > 0) return { amount: serviceType.depositAmount ?? 0, isFull: false };
    return { amount: 0, isFull: false };
  }

  /** پیام کامل جلسه: عنوان وضعیت، خدمت، تاریخ و ساعت، آدرس، لینک عمومی توضیحات و (در صورت نیاز) پرداخت. */
  private async buildMessage(
    ctx: TenantRequestContext,
    appointment: { serviceType: { name: string; location: string | null }; startAt: Date; location: string | null; publicToken: string; paymentStatus: string; depositAmount: number | null; isFullPayment: boolean },
    headline: string,
  ): Promise<string> {
    const location = await this.resolveLocation(ctx, appointment, appointment.serviceType);
    const lines = [headline, `خدمت: ${appointment.serviceType.name}`, `تاریخ و ساعت: ${formatWhen(appointment.startAt)}`];
    if (location) lines.push(`آدرس: ${location}`);
    lines.push(`جزئیات جلسه${appointment.paymentStatus === 'PENDING' ? ' و پرداخت' : ''}: ${this.publicLink(ctx, appointment.publicToken)}`);
    if (appointment.paymentStatus === 'PENDING' && appointment.depositAmount) {
      lines.push(`${appointment.isFullPayment ? 'مبلغ قابل پرداخت' : 'بیعانه'}: ${appointment.depositAmount.toLocaleString('en-US')} تومان`);
    }
    return lines.join('\n');
  }

  /**
   * اتصال به ماژول مشاوره و منتورینگ: نوبت خدماتِ «linkToMentoring» یک جلسه‌ی مشاوره می‌سازد
   * (زیر همکاری فعالِ همان مشتری و مشاور، یا همکاری تازه)، تا صورتجلسه و اقدامات بعدی آنجا ثبت شود.
   * جابه‌جایی/لغو نوبت هم روی جلسه اعمال می‌شود.
   */
  private async syncMentoringSession(
    ctx: TenantRequestContext,
    appointment: { id: string; contactId: string | null; providerUserId: string | null; startAt: Date; endAt: Date; status: string; location: string | null; serviceType: { name: string; price: number; durationMinutes: number; linkToMentoring: boolean; location: string | null } },
  ) {
    if (!appointment.serviceType.linkToMentoring) return;
    const existing = await ctx.tenantDb.mentoringSession.findUnique({ where: { appointmentId: appointment.id } });
    const location = await this.resolveLocation(ctx, appointment, appointment.serviceType);

    if (existing) {
      if (appointment.status === 'CANCELLED') {
        if (existing.status === 'SCHEDULED') await ctx.tenantDb.mentoringSession.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
      } else if (existing.status === 'SCHEDULED') {
        await ctx.tenantDb.mentoringSession.update({
          where: { id: existing.id },
          data: { scheduledAt: appointment.startAt, durationMinutes: appointment.serviceType.durationMinutes, location: location ?? undefined, reminderSentAt: null },
        });
      }
      return;
    }
    if (appointment.status === 'CANCELLED' || !appointment.contactId || !appointment.providerUserId) return;

    const engagement =
      (await ctx.tenantDb.mentoringEngagement.findFirst({
        where: { contactId: appointment.contactId, advisorUserId: appointment.providerUserId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await ctx.tenantDb.mentoringEngagement.create({
        data: {
          contactId: appointment.contactId,
          advisorUserId: appointment.providerUserId,
          title: appointment.serviceType.name,
          pricingModel: 'HOURLY',
          hourlyRate: appointment.serviceType.price > 0 ? appointment.serviceType.price : undefined,
        },
      }));

    await ctx.tenantDb.mentoringSession.create({
      data: {
        engagementId: engagement.id,
        appointmentId: appointment.id,
        mode: location ? 'IN_PERSON' : 'ONLINE',
        scheduledAt: appointment.startAt,
        durationMinutes: appointment.serviceType.durationMinutes,
        location: location ?? undefined,
      },
    });
  }

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
    const terms = this.paymentTerms(serviceType);
    const needsDeposit = terms.amount > 0;
    const contactId = await this.resolveContactId(ctx, dto.contactId, dto.customerName, dto.customerPhone);

    const appointment = await ctx.tenantDb.appointment.create({
      data: {
        serviceTypeId: dto.serviceTypeId,
        contactId,
        providerUserId: dto.providerUserId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        startAt,
        endAt,
        notes: dto.notes,
        createdByUserId,
        status: needsCoordination ? 'PENDING_COORDINATION' : 'SCHEDULED',
        paymentStatus: needsDeposit ? 'PENDING' : 'NONE',
        depositAmount: needsDeposit ? terms.amount : null,
        isFullPayment: needsDeposit && terms.isFull,
      },
      include: APPOINTMENT_INCLUDE,
    });

    await this.logContactHistory(ctx, contactId, `رزرو نوبت «${serviceType.name}» برای ${formatWhen(startAt)} ثبت شد${isPublic ? ' (رزرو آنلاین)' : ''}`, createdByUserId);
    if (!needsCoordination) await this.syncMentoringSession(ctx, appointment);

    await this.automation.emit(ctx, 'booking.appointment.created', {
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      serviceName: appointment.serviceType.name,
      startAt: appointment.startAt.toISOString(),
      providerUserId: appointment.providerUserId,
    });

    if (appointment.customerPhone) {
      const headline = needsCoordination
        ? 'درخواست نوبت شما ثبت شد؛ پس از هماهنگی با کارشناس، زمان نهایی برایتان پیامک می‌شود.'
        : needsDeposit
          ? 'رزرو نوبت شما ثبت شد؛ برای نهایی‌شدن، پرداخت را از لینک زیر انجام دهید.'
          : 'رزرو نوبت شما ثبت شد و در انتظار تأیید است.';
      await this.sms.sendSms(ctx, appointment.customerPhone, await this.buildMessage(ctx, appointment, headline));
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

    const customerName = dto.customerName ?? existing.customerName;
    const customerPhone = dto.customerPhone ?? existing.customerPhone;
    const contactId =
      dto.contactId ?? existing.contactId ?? (await this.resolveContactId(ctx, undefined, customerName, customerPhone));
    const moved = startAt.getTime() !== existing.startAt.getTime() || serviceTypeId !== existing.serviceTypeId || providerUserId !== existing.providerUserId;

    const updated = await ctx.tenantDb.appointment.update({
      where: { id },
      data: {
        serviceTypeId,
        contactId,
        providerUserId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        startAt,
        endAt,
        notes: dto.notes,
        location: dto.location,
      },
      include: APPOINTMENT_INCLUDE,
    });

    if (moved) {
      const actor = await resolveTenantUserId(ctx).catch(() => null);
      await this.logContactHistory(ctx, contactId, `نوبت «${updated.serviceType.name}» به ${formatWhen(updated.startAt)} جابه‌جا/ویرایش شد`, actor);
      await this.syncMentoringSession(ctx, updated);
      if (updated.customerPhone) {
        await this.sms.sendSms(ctx, updated.customerPhone, await this.buildMessage(ctx, updated, 'زمان/مشخصات نوبت شما تغییر کرد. اطلاعات جدید:'));
      }
    }
    return updated;
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
    if (appointment.customerPhone) {
      await this.sms.sendSms(ctx, appointment.customerPhone, await this.buildMessage(ctx, appointment, 'رزرو شما تأیید شد.'));
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
    const actor = await resolveTenantUserId(ctx).catch(() => null);
    await this.logContactHistory(ctx, appointment.contactId, `نوبت «${appointment.serviceType.name}» (${formatWhen(appointment.startAt)}) لغو شد${reason ? `: ${reason}` : ''}`, actor);
    await this.syncMentoringSession(ctx, appointment);
    await this.automation.emit(ctx, 'booking.appointment.cancelled', {
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      serviceName: appointment.serviceType.name,
      startAt: appointment.startAt.toISOString(),
    });
    if (appointment.customerPhone) {
      await this.sms.sendSms(ctx, 
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

    const terms = this.paymentTerms(existing.serviceType);
    const needsDeposit = terms.amount > 0;
    const appointment = await ctx.tenantDb.appointment.update({
      where: { id },
      data: {
        startAt,
        endAt,
        providerUserId,
        status: 'SCHEDULED',
        coordinationRespondedAt: new Date(),
        paymentStatus: needsDeposit ? 'PENDING' : 'NONE',
        depositAmount: needsDeposit ? terms.amount : null,
        isFullPayment: needsDeposit && terms.isFull,
      },
      include: APPOINTMENT_INCLUDE,
    });

    await this.syncMentoringSession(ctx, appointment);
    if (appointment.customerPhone) {
      const headline = needsDeposit ? 'هماهنگی نوبت شما انجام شد؛ برای نهایی‌شدن، پرداخت را از لینک زیر انجام دهید.' : 'نوبت شما نهایی و تأیید شد.';
      await this.sms.sendSms(ctx, appointment.customerPhone, await this.buildMessage(ctx, appointment, headline));
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
      description: `${appointment.isFullPayment ? 'پرداخت' : 'بیعانه'} نوبت «${appointment.serviceType.name}» — ${appointment.customerName}`,
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

    const updated = await this.settlePayment(ctx, id, 'ZARINPAL', verified.refId);

    return { success: true as const, appointment: updated };
  }

  /** پرداخت (آنلاین یا دستی) نهایی شد: نوبت تأیید می‌شود و پیام کامل جلسه + رسید برای مشتری می‌رود. */
  private async settlePayment(ctx: TenantRequestContext, id: string, method: string, refId?: number) {
    const before = await ctx.tenantDb.appointment.findUniqueOrThrow({ where: { id } });
    const updated = await ctx.tenantDb.appointment.update({
      where: { id },
      data: {
        paymentStatus: 'PAID',
        paidAt: new Date(),
        paymentMethod: method,
        paymentRefId: refId,
        status: before.status === 'SCHEDULED' ? 'CONFIRMED' : undefined,
      },
      include: APPOINTMENT_INCLUDE,
    });

    const actor = await resolveTenantUserId(ctx).catch(() => null);
    await this.logContactHistory(ctx, updated.contactId, `پرداخت ${updated.isFullPayment ? 'کامل' : 'بیعانه'} نوبت «${updated.serviceType.name}» (${(updated.depositAmount ?? 0).toLocaleString('en-US')} تومان) ثبت شد`, actor);

    await this.automation.emit(ctx, 'booking.appointment.deposit_paid', {
      customerName: updated.customerName,
      serviceName: updated.serviceType.name,
      startAt: updated.startAt.toISOString(),
      depositAmount: updated.depositAmount,
    });

    if (updated.customerPhone) {
      const receipt = refId ? ` — کد پیگیری: ${refId}` : '';
      await this.sms.sendSms(ctx, updated.customerPhone, await this.buildMessage(ctx, updated, `پرداخت شما ثبت شد${receipt} و رزرو نهایی است.`));
    }
    if (updated.provider?.phone) {
      await this.sms.sendSms(
        ctx,
        updated.provider.phone,
        `پرداخت نوبت «${updated.serviceType.name}» با مشتری ${updated.customerName} در ${formatWhen(updated.startAt)} انجام شد.`,
      );
    }
    return updated;
  }

  /** ثبت دستی پرداخت (نقد/کارت/انتقال) روی نوبت — برای مشتری حضوری یا وقتی آنلاین پرداخت نشده. */
  async recordManualPayment(ctx: TenantRequestContext, id: string, dto: { method: string; amount?: number }) {
    const appointment = await ctx.tenantDb.appointment.findUnique({ where: { id }, include: { serviceType: true } });
    if (!appointment) throw new NotFoundException('نوبت یافت نشد');
    if (appointment.paymentStatus === 'PAID') throw new ConflictException('پرداخت این نوبت قبلاً ثبت شده است');
    if (appointment.status === 'CANCELLED') throw new ConflictException('نوبت لغوشده پرداخت نمی‌گیرد');

    const amount = dto.amount ?? appointment.depositAmount ?? 0;
    if (amount <= 0) throw new BadRequestException('مبلغ پرداخت را وارد کنید');
    if (appointment.paymentStatus !== 'PENDING' || appointment.depositAmount !== amount) {
      await ctx.tenantDb.appointment.update({
        where: { id },
        data: { depositAmount: amount, isFullPayment: amount >= appointment.serviceType.price && appointment.serviceType.price > 0 },
      });
    }
    return this.settlePayment(ctx, id, dto.method);
  }

  /** نمای عمومی نوبت با publicToken — صفحه‌ی «توضیحات جلسه» که لینکش داخل پیامک است. */
  async publicView(ctx: TenantRequestContext, token: string) {
    const appointment = await ctx.tenantDb.appointment.findUnique({
      where: { publicToken: token },
      include: { serviceType: true, provider: { select: { name: true } } },
    });
    if (!appointment) throw new NotFoundException('این لینک معتبر نیست');
    return {
      id: appointment.id,
      serviceName: appointment.serviceType.name,
      description: appointment.serviceType.description,
      customerName: appointment.customerName,
      providerName: appointment.provider?.name ?? null,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      status: appointment.status,
      location: await this.resolveLocation(ctx, appointment, appointment.serviceType),
      paymentStatus: appointment.paymentStatus,
      amount: appointment.depositAmount,
      isFullPayment: appointment.isFullPayment,
    };
  }

  async initiatePaymentByToken(ctx: TenantRequestContext, token: string, callbackBase: string) {
    const appointment = await ctx.tenantDb.appointment.findUnique({ where: { publicToken: token }, select: { id: true } });
    if (!appointment) throw new NotFoundException('این لینک معتبر نیست');
    return this.initiateDepositPayment(ctx, appointment.id, `${callbackBase}/appointments/${appointment.id}/callback`);
  }

  async sendDetails(ctx: TenantRequestContext, id: string) {
    const appointment = await ctx.tenantDb.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE });
    if (!appointment) throw new NotFoundException('نوبت یافت نشد');
    if (!appointment.customerPhone) throw new BadRequestException('برای این نوبت شماره‌ی موبایل ثبت نشده است');
    const result = await this.sms.sendSms(ctx, appointment.customerPhone, await this.buildMessage(ctx, appointment, 'یادآوری جزئیات رزرو شما:'));
    if (!result.success) throw new BadRequestException(result.error);
    return { success: true };
  }
}
