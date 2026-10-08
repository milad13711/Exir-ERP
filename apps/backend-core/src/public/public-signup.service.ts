import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import type { SignupTicketPayload, TenantJwtPayload } from '../auth/jwt-payload.type.js';

const SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The unauthenticated half of tenant onboarding — everything a prospective
 * customer can do before they're a member of anything. Kept separate from
 * AuthService (login for an existing membership) and TenantsService (the
 * actual provisioning, shared with the admin-created path) rather than
 * folded into either, so neither of those two well-exercised paths has to
 * change shape to accommodate a public caller.
 */
@Injectable()
export class PublicSignupService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
    private readonly epoch: SessionEpochService,
  ) {}

  requestOtp(phone: string) {
    return this.auth.requestOtp(phone, 'SIGNUP');
  }

  /** Verifies a SIGNUP-purpose OTP and, on success, mints a short-lived ticket proving phone ownership for the create-tenant step. */
  async verifyOtp(phone: string, code: string): Promise<{ signupToken: string; expiresInSeconds: number }> {
    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'SIGNUP', consumedAt: null, expiresAt: { gt: new Date() } },
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

    const payload: SignupTicketPayload = { type: 'signup_ticket', phone };
    const signupToken = await this.jwt.signAsync(payload, { expiresIn: SIGNUP_TOKEN_TTL_SECONDS });
    return { signupToken, expiresInSeconds: SIGNUP_TOKEN_TTL_SECONDS };
  }

  async checkSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.controlDb.tenant.findUnique({ where: { slug }, select: { id: true } });
    return !existing;
  }

  private async resolveSignupPhone(signupToken: string): Promise<string> {
    let payload: SignupTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<SignupTicketPayload>(signupToken);
    } catch {
      throw new UnauthorizedException('نشست ثبت‌نام منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'signup_ticket') {
      throw new UnauthorizedException('نشست ثبت‌نام نامعتبر است');
    }
    return payload.phone;
  }

  async createTenant(input: {
    signupToken: string;
    businessName: string;
    slug: string;
    ownerName: string;
    planCode: string;
    industryTemplateCode?: string;
    extraModuleCodes?: string[];
    resellerCode?: string;
  }): Promise<{ tenant: { name: string; slug: string; status: string }; requiresPayment: boolean; accessToken?: string }> {
    const ownerPhone = await this.resolveSignupPhone(input.signupToken);

    const plan = await this.controlDb.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isPubliclySold) throw new NotFoundException('پلن انتخاب‌شده یافت نشد');

    const tenant = await this.tenants.createTenant(
      {
        name: input.businessName,
        slug: input.slug,
        ownerPhone,
        ownerName: input.ownerName,
        planCode: input.planCode,
        industryTemplateCode: input.industryTemplateCode,
        extraModuleCodes: input.extraModuleCodes,
        resellerCode: input.resellerCode,
        isPublicSignup: true,
      },
      { type: 'system', id: null },
    );

    const requiresPayment = tenant.status === 'PENDING_PAYMENT';
    if (requiresPayment) {
      return { tenant: { name: tenant.name, slug: tenant.slug, status: tenant.status }, requiresPayment: true };
    }

    // Free-to-start (e.g. a plan with no monthly price) — log the new owner
    // straight in instead of making them go through OTP login a second time.
    const globalUser = await this.controlDb.globalUser.findUniqueOrThrow({ where: { phone: ownerPhone } });
    const membership = await this.controlDb.tenantMembership.findUniqueOrThrow({
      where: { tenantId_globalUserId: { tenantId: tenant.id, globalUserId: globalUser.id } },
    });
    const payload: TenantJwtPayload = {
      type: 'tenant_user',
      sub: globalUser.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      role: membership.role,
      tv: await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion),
    };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      tenant: { name: tenant.name, slug: tenant.slug, status: tenant.status },
      requiresPayment: false,
      accessToken,
    };
  }
}
