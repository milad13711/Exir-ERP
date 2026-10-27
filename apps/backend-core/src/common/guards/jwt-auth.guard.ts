import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import type { TenantAuthPayload, TenantJwtPayload } from '../../auth/jwt-payload.type.js';
import { API_KEY_PREFIX } from '../../api-keys/api-key.constants.js';
import { SessionEpochService } from '../../security/session-epoch.service.js';
import { SecurityEventsService } from '../../security/security-events.service.js';
import { recordApiKeyUse, verifyApiKeyToken } from '../../api-keys/api-key-verifier.js';
import { canRead, canWrite, hasModuleRestriction, ipAllowed, isLegacyKey, isRestWriteMethod, moduleAllowed } from '../../api-keys/api-key-scopes.js';
import { API_KEY_SELF_SCOPED_KEY } from '../decorators/api-key-self-scoped.decorator.js';
import { API_KEY_ALLOWED_KEY, HUMAN_ONLY_KEY } from '../decorators/human-only.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { isHumanOnlyPath } from '../../api-keys/api-key-human-only.js';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator.js';
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
    @Optional() private readonly reflector?: Reflector,
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

    if (payload.type === 'api_key') this.enforceKeyScopes(payload.scopes, context, req);

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

  /**
   * اعمال دامنه‌ی کلید API روی REST: متد نوشتنی نیازمند `write`؛ در صورت محدودیت ماژولی فقط روت‌های @RequireModule
   * با ماژول مجاز (روت بدون ماژول برای کلید محدودشده بسته است — fail-closed). روت‌های خودمحدودکننده (MCP) استثنا هستند.
   */
  private enforceKeyScopes(scopes: string[] | undefined, context: ExecutionContext, req: Request): void {
    const hasMeta = typeof context.getHandler === 'function' && typeof context.getClass === 'function';
    const meta = <T>(key: string): T | undefined => (hasMeta ? this.reflector?.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]) : undefined);
    // مسیرهای مدیریتی/امنیتی فقط برای انسان — برای همه‌ی کلیدها (حتی قدیمی با دسترسی کامل).
    const roleGated = !!meta<unknown[]>(ROLES_KEY) && !meta<boolean>(API_KEY_ALLOWED_KEY);
    if (meta<boolean>(HUMAN_ONLY_KEY) || roleGated || isHumanOnlyPath(req.originalUrl ?? req.url ?? req.path)) {
      throw new ForbiddenException('این بخش فقط با ورود کاربر داخل پنل قابل‌استفاده است و با کلید API در دسترس نیست');
    }
    if (isLegacyKey(scopes)) return;
    if (meta<boolean>(API_KEY_SELF_SCOPED_KEY)) {
      if (!canRead(scopes)) throw new ForbiddenException('این کلید API دسترسی خواندن ندارد');
      return;
    }
    if (!canRead(scopes)) throw new ForbiddenException('این کلید API دسترسی خواندن ندارد');
    if (isRestWriteMethod(req.method) && !canWrite(scopes)) {
      throw new ForbiddenException('این کلید API فقط‌خواندنی است و اجازه‌ی ثبت یا تغییر داده را ندارد');
    }
    if (hasModuleRestriction(scopes)) {
      const moduleCode = meta<string>(REQUIRE_MODULE_KEY);
      if (!moduleCode || !moduleAllowed(scopes, moduleCode)) {
        throw new ForbiddenException('این کلید API به این بخش دسترسی ندارد');
      }
    }
  }

  private async verifyApiKey(token: string, req: Request): Promise<TenantAuthPayload> {
    const hit = await verifyApiKeyToken(this.controlDb, token);
    const ip = clientIp(req);
    // کلید نامعتبر، ابطال‌شده، منقضی‌شده یا IP غیرمجاز: همه یک پاسخ ۴۰۱ یکسان می‌گیرند تا حالت کلید قابل‌حدس نباشد.
    if (!hit || !ipAllowed(ip, hit.ipAllowlist)) {
      this.events.record({
        type: 'API_KEY_AUTH_FAILED',
        severity: 'WARNING',
        ip,
        message: hit ? 'API key used from a disallowed IP' : 'invalid API key presented',
        dedupeKey: ip,
      });
      throw new UnauthorizedException('کلید API نامعتبر یا غیرفعال است');
    }
    recordApiKeyUse(this.controlDb, hit.id, ip);
    return { type: 'api_key', sub: hit.id, tenantId: hit.tenantId, role: 'OWNER', scopes: hit.scopes };
  }
}
