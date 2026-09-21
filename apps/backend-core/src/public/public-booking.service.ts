import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { ServiceTypesService } from '../booking/service-types.service.js';
import { AppointmentsService } from '../booking/appointments.service.js';
import { BookingSlotsService } from '../booking/booking-slots.service.js';
import type { BookingTicketPayload } from '../auth/jwt-payload.type.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto.js';

const BOOKING_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The unauthenticated half of appointment booking — a customer picking
 * their own service/specialist/time via a public link, no tenant login
 * involved. Mirrors PublicSignupService's shape (OTP request/verify -> a
 * short-lived ticket -> the actual write), and reuses BookingModule's own
 * services for the parts that are identical to the staff-facing flow
 * (listing, overlap-checked creation) rather than duplicating that logic.
 */
@Injectable()
export class PublicBookingService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly serviceTypes: ServiceTypesService,
    private readonly appointments: AppointmentsService,
    private readonly slots: BookingSlotsService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const bookingModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'booking' } },
    });
    if (!bookingModule) {
      throw new NotFoundException('رزرو آنلاین برای این کسب‌وکار فعال نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async listServiceTypes(slug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    return this.serviceTypes.list(ctx, false);
  }

  /** نام کسب‌وکار و آدرس دفتر/محل برگزاری — روی فرم عمومی رزرو نمایش داده می‌شود. */
  async getInfo(slug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const [tenant, addressRow] = await Promise.all([
      this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }),
      ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'address' } } }),
    ]);
    const address = typeof addressRow?.value === 'string' ? addressRow.value : null;
    return { businessName: tenant?.name ?? '', address };
  }

  async listFreeSlots(slug: string, serviceTypeId: string, providerUserId: string | undefined, date: string) {
    const ctx = await this.resolveTenantCtx(slug);
    return this.slots.listFreeSlots(ctx, { serviceTypeId, providerUserId: providerUserId || undefined, date });
  }

  async listProviders(slug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    return ctx.tenantDb.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async requestOtp(slug: string, phone: string) {
    await this.resolveTenantCtx(slug); // 404s early for an unknown/unbooked-slug rather than sending an OTP for nothing
    return this.auth.requestOtp(phone, 'BOOKING');
  }

  async verifyOtp(slug: string, phone: string, code: string): Promise<{ bookingToken: string; expiresInSeconds: number }> {
    await this.resolveTenantCtx(slug);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'BOOKING', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= 5) {
      throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const payload: BookingTicketPayload = { type: 'booking_ticket', phone, tenantSlug: slug };
    const bookingToken = await this.jwt.signAsync(payload, { expiresIn: BOOKING_TOKEN_TTL_SECONDS });
    return { bookingToken, expiresInSeconds: BOOKING_TOKEN_TTL_SECONDS };
  }

  private async resolveBookingPhone(slug: string, bookingToken: string): Promise<string> {
    let payload: BookingTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<BookingTicketPayload>(bookingToken);
    } catch {
      throw new UnauthorizedException('نشست رزرو منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'booking_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست رزرو نامعتبر است');
    }
    return payload.phone;
  }

  async createAppointment(slug: string, dto: CreatePublicAppointmentDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const customerPhone = await this.resolveBookingPhone(slug, dto.bookingToken);

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime()) || startAt.getTime() < Date.now()) {
      throw new BadRequestException('زمان انتخاب‌شده معتبر نیست');
    }

    return this.appointments.createPublic(ctx, {
      serviceTypeId: dto.serviceTypeId,
      providerUserId: dto.providerUserId,
      customerName: dto.customerName,
      customerPhone,
      startAt: dto.startAt,
      notes: dto.notes,
    });
  }
}
