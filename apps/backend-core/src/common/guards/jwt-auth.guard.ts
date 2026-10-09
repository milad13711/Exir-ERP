import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import type { TenantAuthPayload, TenantJwtPayload } from '../../auth/jwt-payload.type.js';
import { API_KEY_PREFIX } from '../../api-keys/api-key.constants.js';
import { SessionEpochService } from '../../security/session-epoch.service.js';
import { SecurityEventsService } from '../../security/security-events.service.js';
import { verifyApiKeyToken } from '../../api-keys/api-key-verifier.js';
import { clientIp } from '../../security/client-ip.js';
import {
  effectiveMode,
  evaluateTwoFactor,
  graceDays,
  isAllowedForRestrictedSession,
  twoFactorRequiredError,
  type TwoFactorState,
} from '../../auth/tenant-two-factor-policy.js';

type VerifiedUser = {
  payload: TenantAuthPayload;
  membershipTokenVersion: number;
  membershipId?: string;
  enrolled?: boolean;
  graceStartedAt?: Date | null;
};

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/**
 * Verifies a tenant-scoped access token, then resolves that tenant's own
 * database connection and attaches a ready-to-use Prisma client for it to
 * the request as `req.ctx.tenantDb` — every tenant-scoped controller reads
 * from `req.ctx`, never from a raw tenantId a client could tamper with.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly epoch: SessionEpochService,
    private readonly events: SecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedException('توکن ورود یافت نشد');

    const verified: VerifiedUser = token.startsWith(API_KEY_PREFIX)
      ? { payload: await this.verifyApiKey(token, req), membershipTokenVersion: 0 }
      : await this.verifyUserToken(token);
    const payload = verified.payload;

    const tenant = await this.controlDb.tenant.findUnique({
      where: { id: payload.tenantId },
    });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new UnauthorizedException('دسترسی به این محیط کاری غیرفعال شده است');
    }
    if (payload.type === 'tenant_user') {
      // ابطال سراسری/تننتی/عضو: توکن با نسخه‌ی کمتر از نسخه‌ی مؤثر فعلی، نشست باطل‌شده است.
      const required = await this.epoch.effective(tenant.tokenVersion, verified.membershipTokenVersion);
      if ((payload.tv ?? 0) < required) {
        throw new UnauthorizedException('نشست شما باطل شده است، دوباره وارد شوید');
      }
    }
    let twoFactor: TwoFactorState | undefined;
    if (payload.type === 'tenant_user') {
      twoFactor = await this.resolveTwoFactor(tenant.twoFactorPolicy, payload, verified);
      if (twoFactor.restricted) {
        // نشست محدود (الزام 2FA مالک/مدیر): فقط ثبت 2FA و /me — همه‌ی بقیه‌ی مسیرها 403.
        const fullPath = req.originalUrl ?? req.url ?? req.path ?? '';
        if (!isAllowedForRestrictedSession(req.method ?? 'GET', fullPath)) throw twoFactorRequiredError();
      }
    }
    if (tenant.status === 'PENDING_PAYMENT') {
      // مشتری اجازه‌ی ورود دارد، اما تا پرداخت فاکتور معلق، فقط به صفحه‌ی
      // صورت‌حساب (billing/*) دسترسی می‌گیرد — نه به داده‌های واقعی کسب‌وکار.
      // کد ۴۰۲ عمداً از ۴۰۱ جداست تا فرانت‌اند به‌جای خروج از حساب، کاربر را
      // به صفحه‌ی پرداخت فاکتور هدایت کند.
      const path: string = req.path ?? '';
      const isBillingRoute = path.includes('/billing/') || path.endsWith('/billing');
      if (!isBillingRoute) {
        throw new HttpException(
          {
            message: 'برای فعال‌سازی این محیط کاری، ابتدا فاکتور صادرشده باید پرداخت شود.',
            billingLocked: true,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    const tenantDb = this.tenantPrisma.forTenant({
      dbHost: tenant.dbHost,
      dbPort: tenant.dbPort,
      dbName: tenant.dbName,
    });

    req.ctx = {
      auth: payload,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantDb,
      ...(twoFactor ? { twoFactor } : {}),
    };
    return true;
  }

  private async verifyUserToken(token: string): Promise<VerifiedUser> {
    let payload: TenantJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<TenantJwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده است، دوباره وارد شوید');
    }
    if (payload.type !== 'tenant_user' || !payload.tenantId) {
      throw new UnauthorizedException('این نشست برای محیط کاری معتبر نیست، دوباره وارد شوید');
    }
    // نقش مدیریتی از توکن قدیمی خوانده نمی‌شود: تنزل/انتقال مدیر کل یا حذف کاربر باید فوراً اعمال شود.
    const membership = await this.controlDb.tenantMembership.findUnique({
      where: { id: payload.membershipId },
      include: { globalUser: { select: { totpEnabledAt: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException('دسترسی شما به این محیط کاری حذف یا غیرفعال شده است');
    }
    return {
      payload: { ...payload, role: membership.role },
      membershipTokenVersion: membership.tokenVersion,
      membershipId: membership.id,
      enrolled: !!membership.globalUser?.totpEnabledAt,
      graceStartedAt: membership.twoFactorGraceStartedAt ?? null,
    };
  }

  /** وضعیت 2FA اجباری؛ در حالت grace ساعت مهلت را در اولین دیده‌شدنِ مالک/مدیرِ بدون 2FA می‌افتاند. */
  private async resolveTwoFactor(tenantOverride: string | null | undefined, payload: TenantAuthPayload, v: VerifiedUser): Promise<TwoFactorState> {
    const mode = effectiveMode(tenantOverride);
    let graceStartedAt = v.graceStartedAt ?? null;
    const base = { mode, role: payload.role, authType: payload.type, enrolled: v.enrolled ?? false, graceDays: graceDays() };
    if (mode === 'grace' && !base.enrolled && !graceStartedAt && v.membershipId && evaluateTwoFactor({ ...base, graceStartedAt: new Date() }).required) {
      graceStartedAt = new Date();
      try {
        // فقط اگر هنوز null است (رقابت‌های هم‌زمان ساعت را جلو نمی‌برند)
        await this.controlDb.tenantMembership.updateMany({ where: { id: v.membershipId, twoFactorGraceStartedAt: null }, data: { twoFactorGraceStartedAt: graceStartedAt } });
      } catch {
        /* ثبت ساعت مهلت هیچ‌وقت درخواست را نمی‌شکند؛ درخواست بعدی دوباره تلاش می‌کند */
      }
    }
    return evaluateTwoFactor({ ...base, graceStartedAt });
  }

  private async verifyApiKey(token: string, req: Request): Promise<TenantAuthPayload> {
    const hit = await verifyApiKeyToken(this.controlDb, token);
    if (!hit) {
      this.events.record({
        type: 'API_KEY_AUTH_FAILED',
        severity: 'WARNING',
        ip: clientIp(req),
        message: 'invalid API key presented',
        dedupeKey: clientIp(req),
      });
      throw new UnauthorizedException('کلید API نامعتبر یا غیرفعال است');
    }
    return { type: 'api_key', sub: hit.id, tenantId: hit.tenantId, role: 'OWNER' };
  }
}
