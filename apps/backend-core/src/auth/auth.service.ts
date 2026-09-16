import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import type { OtpPurpose } from '../../generated/control-client/index.js';
import type { TenantJwtPayload, TenantSelectionTicketPayload } from './jwt-payload.type.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const TENANT_SELECTION_TOKEN_TTL_SECONDS = 15 * 60;

function generateOtpCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

@Injectable()
export class AuthService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly sms: ExirSmsService,
  ) {}

  async requestOtp(
    phone: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<{ expiresInSeconds: number; devCode?: string }> {
    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);

    await this.controlDb.otpCode.create({
      data: {
        phone,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    const devEcho = process.env.OTP_DEV_ECHO === 'true';
    let smsSent = false;

    if (this.sms.isConfigured()) {
      const purposeText: Record<OtpPurpose, string> = {
        LOGIN: 'کد ورود شما',
        TENANT_INVITE: 'کد ورود شما',
        SIGNUP: 'کد تأیید ثبت‌نام شما',
        BOOKING: 'کد تأیید رزرو نوبت شما',
        TRACKING: 'کد تأیید پیگیری پروژه‌ی شما',
        CONTRACT_SIGN: 'کد تأیید امضای قرارداد شما',
        LAB_REVIEW: 'کد ورود شما به پورتال آزمایشگاه جیره',
        RATION_RESULT: 'کد تأیید مشاهده‌ی نتیجه‌ی آزمایش جیره',
      };
      const message = `${purposeText[purpose]} در اکسیر ERP: ${code}`;
      const result = await this.sms.sendSms(phone, message);
      smsSent = result.success;
      if (!result.success) {
        await this.controlDb.errorLog.create({
          data: {
            service: 'backend-core',
            level: 'ERROR',
            message: `ارسال پیامک کد ورود ناموفق بود: ${result.error}`,
            context: { phone },
          },
        });
      }
    }

    // devCode is only ever returned when the real SMS wasn't sent (either
    // exirsms.ir isn't configured, or the request to it failed) — never
    // alongside a successful send, even with OTP_DEV_ECHO=true, so a real
    // deployment's logs/responses don't casually leak a code SMS already
    // delivered to the user's phone.
    return {
      expiresInSeconds: OTP_TTL_MS / 1000,
      ...(devEcho && !smsSent ? { devCode: code } : {}),
    };
  }

  /**
   * Validates + consumes a LOGIN OTP for a phone, independent of which
   * tenant the login is ultimately for — a phone can belong to several
   * tenants (this box hosts public self-signup, so the same person can
   * have created more than one workspace), and the OTP itself has nothing
   * to do with which one they're logging into.
   */
  private async consumeLoginOtp(phone: string, code: string): Promise<void> {
    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  async verifyOtp(
    phone: string,
    code: string,
    tenantSlug?: string,
  ): Promise<
    | {
        accessToken: string;
        user: { name: string | null; phone: string };
        tenant: { name: string; slug: string };
        role: string;
        billingLocked?: boolean;
        outstandingInvoiceId?: string | null;
      }
    | { requiresTenantSelection: true; verificationToken: string; tenants: { slug: string; name: string }[] }
  > {
    await this.consumeLoginOtp(phone, code);

    if (tenantSlug) {
      return this.resolveTenantLogin(phone, tenantSlug);
    }

    const globalUser = await this.controlDb.globalUser.findUnique({ where: { phone } });
    if (!globalUser) {
      throw new NotFoundException('این شماره در هیچ محیط کاری عضو نیست');
    }

    // یک تننت PENDING_PAYMENT هم باید اجازه‌ی ورود بدهد — فقط بعد از ورود در
    // پنل قفل و فاکتور معلق نشانش داده می‌شود (resolveTenantLogin/JwtAuthGuard)،
    // نه اینکه اصلاً انکار شود و به مشتری وانمود کند حسابش پاک شده.
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: {
        globalUserId: globalUser.id,
        status: { in: ['ACTIVE', 'INVITED'] },
        tenant: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      },
      include: { tenant: true },
    });

    if (memberships.length === 0) {
      throw new NotFoundException('این شماره در هیچ محیط کاری فعال عضو نیست');
    }
    if (memberships.length === 1) {
      return this.resolveTenantLogin(phone, memberships[0].tenant.slug);
    }

    const ticketPayload: TenantSelectionTicketPayload = { type: 'tenant_selection_ticket', phone };
    const verificationToken = await this.jwt.signAsync(ticketPayload, { expiresIn: TENANT_SELECTION_TOKEN_TTL_SECONDS });
    return {
      requiresTenantSelection: true,
      verificationToken,
      tenants: memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name })),
    };
  }

  /** برای گام دوم انتخاب محیط کاری — کد OTP دوباره لازم نیست، چون همین الان مصرف شده است. */
  async selectTenant(verificationToken: string, tenantSlug: string) {
    let payload: TenantSelectionTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TenantSelectionTicketPayload>(verificationToken);
    } catch {
      throw new UnauthorizedException('نشست انتخاب محیط کاری منقضی شده است، دوباره کد را درخواست دهید');
    }
    if (payload.type !== 'tenant_selection_ticket') {
      throw new UnauthorizedException('نشست انتخاب محیط کاری نامعتبر است');
    }
    return this.resolveTenantLogin(payload.phone, tenantSlug);
  }

  /** برای سوییچ محیط کاری از داخل خود پنل (هدر) — کاربر از قبل با JWT وارد شده است. */
  async listMyTenants(globalUserId: string): Promise<{ slug: string; name: string }[]> {
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { globalUserId, status: 'ACTIVE', tenant: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } } },
      include: { tenant: true },
    });
    return memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.name }));
  }

  /** سوییچ به یک محیط کاری دیگر که کاربر از قبل عضو فعال آن است — بدون نیاز به کد تأیید مجدد. */
  async switchTenant(globalUserId: string, tenantSlug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || (tenant.status !== 'ACTIVE' && tenant.status !== 'PENDING_PAYMENT')) {
      throw new NotFoundException('این محیط کاری یافت نشد یا فعال نیست');
    }

    const membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException('شما عضو فعال این محیط کاری نیستید');
    }

    const globalUser = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    const payload: TenantJwtPayload = {
      type: 'tenant_user',
      sub: globalUser.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
    };
    const accessToken = await this.jwt.signAsync(payload);

    let billingLocked: boolean | undefined;
    let outstandingInvoiceId: string | null = null;
    if (tenant.status === 'PENDING_PAYMENT') {
      billingLocked = true;
      const invoice = await this.controlDb.invoice.findFirst({
        where: { tenantId: tenant.id, status: 'PENDING' },
        orderBy: { issuedAt: 'desc' },
      });
      outstandingInvoiceId = invoice?.id ?? null;
    }

    return {
      accessToken,
      user: { name: globalUser.name, phone: globalUser.phone },
      tenant: { name: tenant.name, slug: tenant.slug },
      role: membership.role,
      ...(billingLocked ? { billingLocked, outstandingInvoiceId } : {}),
    };
  }

  private async resolveTenantLogin(phone: string, tenantSlug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: tenantSlug } });
    // یک تننت PENDING_PAYMENT (تریال تمام‌شده) هم اجازه‌ی ورود می‌گیرد — فقط
    // با یک نشست قفل‌شده که JwtAuthGuard آن را به دیدن/پرداخت فاکتور محدود
    // می‌کند؛ هرگز نباید به مشتری وانمود کند حسابش پاک یا پیدا نشده است.
    if (!tenant || (tenant.status !== 'ACTIVE' && tenant.status !== 'PENDING_PAYMENT')) {
      throw new NotFoundException('این محیط کاری یافت نشد یا فعال نیست');
    }

    const globalUser = await this.controlDb.globalUser.findUnique({ where: { phone } });
    if (!globalUser) {
      throw new NotFoundException('این شماره در هیچ محیط کاری عضو نیست');
    }

    let membership = await this.controlDb.tenantMembership.findUnique({
      where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId: globalUser.id } },
    });
    if (!membership) {
      throw new UnauthorizedException('این شماره عضو این محیط کاری نیست');
    }
    if (membership.status === 'DISABLED') {
      throw new UnauthorizedException('دسترسی شما به این محیط کاری غیرفعال شده است');
    }
    if (membership.status === 'INVITED') {
      membership = await this.controlDb.tenantMembership.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
      const tenantDb = this.tenantPrisma.forTenant({
        dbHost: tenant.dbHost,
        dbPort: tenant.dbPort,
        dbName: tenant.dbName,
      });
      await tenantDb.user.updateMany({
        where: { globalUserId: globalUser.id },
        data: { status: 'ACTIVE' },
      });
    }

    await this.controlDb.globalUser.update({
      where: { id: globalUser.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: TenantJwtPayload = {
      type: 'tenant_user',
      sub: globalUser.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
    };
    const accessToken = await this.jwt.signAsync(payload);

    let billingLocked: boolean | undefined;
    let outstandingInvoiceId: string | null = null;
    if (tenant.status === 'PENDING_PAYMENT') {
      billingLocked = true;
      const invoice = await this.controlDb.invoice.findFirst({
        where: { tenantId: tenant.id, status: 'PENDING' },
        orderBy: { issuedAt: 'desc' },
      });
      outstandingInvoiceId = invoice?.id ?? null;
    }

    return {
      accessToken,
      user: { name: globalUser.name, phone: globalUser.phone },
      tenant: { name: tenant.name, slug: tenant.slug },
      role: membership.role,
      ...(billingLocked ? { billingLocked, outstandingInvoiceId } : {}),
    };
  }
}
