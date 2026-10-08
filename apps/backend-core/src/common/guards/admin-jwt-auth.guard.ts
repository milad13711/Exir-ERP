import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import type { AdminJwtPayload } from '../../auth/jwt-payload.type.js';
import { SessionEpochService } from '../../security/session-epoch.service.js';

/** تنها مسیرهایی که نشست محدود (تغییر رمز اجباری) اجازه‌ی استفاده از آن‌ها را دارد: «METHOD /api/...». */
export const RESTRICTED_SESSION_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/admin/auth/me',
  'POST /api/admin/auth/change-password',
  'POST /api/admin/auth/logout',
]);

/**
 * Verifies an internal-staff (management team) token. Completely separate
 * identity space from tenant users — an AdminUser can never sign in as a
 * tenant, and a tenant user's token is never accepted here.
 *
 * ابطال: توکن با `tv` کمتر از (epoch سراسری + tokenVersion این کارشناس) رد می‌شود.
 * رمز پیش‌فرض/یک‌بارمصرف: نشست محدود (claim mcp یا پرچم mustChangePassword در DB) فقط به RESTRICTED_SESSION_ROUTES
 * دسترسی دارد؛ بقیه‌ی مسیرها 403 با code=PASSWORD_CHANGE_REQUIRED می‌دهند.
 * ADMIN_REQUIRE_TOTP=true: کارشناسِ بدون 2FA فقط به مسیرهای /admin/auth/2fa/* دسترسی دارد تا ثبت‌نام 2FA را کامل کند.
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
    private readonly epoch: SessionEpochService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('توکن ورود یافت نشد');
    }
    const token = header.slice('Bearer '.length);

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده است، دوباره وارد شوید');
    }
    if (payload.isAdmin !== true) throw new UnauthorizedException();

    const admin = await this.controlDb.adminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('حساب کارشناسی شما غیرفعال است');
    }
    const required = await this.epoch.effective(admin.tokenVersion);
    if ((payload.tv ?? 0) < required) {
      throw new UnauthorizedException('نشست شما باطل شده است، دوباره وارد شوید');
    }
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0].replace(/\/+$/, '');
    if (payload.mcp === true || admin.mustChangePassword) {
      if (!RESTRICTED_SESSION_ROUTES.has(`${(req.method ?? 'GET').toUpperCase()} ${path}`)) {
        throw new ForbiddenException({ message: 'برای ادامه باید رمز عبور خود را تغییر دهید', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      req.adminCtx = { auth: payload };
      return true;
    }
    if (process.env.ADMIN_REQUIRE_TOTP === 'true' && !admin.totpEnabledAt) {
      if (!path.startsWith('/api/admin/auth/2fa/') && !(req.method === 'GET' && path === '/api/admin/auth/me')) {
        throw new ForbiddenException({ message: 'برای ادامه باید تأیید دومرحله‌ای را فعال کنید', code: 'TOTP_ENROLLMENT_REQUIRED' });
      }
    }

    req.adminCtx = { auth: payload };
    return true;
  }
}
