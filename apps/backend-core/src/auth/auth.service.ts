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
import type { TenantJwtPayload } from './jwt-payload.type.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;

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

  async verifyOtp(
    phone: string,
    code: string,
    tenantSlug: string,
  ): Promise<{
    accessToken: string;
    user: { name: string | null; phone: string };
    tenant: { name: string; slug: string };
    role: string;
  }> {
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

    const tenant = await this.controlDb.tenant.findUnique({ where: { slug: tenantSlug } });
    if (tenant?.status === 'PENDING_PAYMENT') {
      throw new UnauthorizedException(
        'برای فعال‌سازی این محیط کاری، ابتدا فاکتور صادرشده باید پرداخت شود. با پشتیبانی اکسیر تماس بگیرید.',
      );
    }
    if (!tenant || tenant.status !== 'ACTIVE') {
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

    return {
      accessToken,
      user: { name: globalUser.name, phone: globalUser.phone },
      tenant: { name: tenant.name, slug: tenant.slug },
      role: membership.role,
    };
  }
}
