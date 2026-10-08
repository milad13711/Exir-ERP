import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { AdminJwtPayload, TenantJwtPayload } from '../auth/jwt-payload.type.js';
import { SessionEpochService } from './session-epoch.service.js';

/**
 * همان اعتبارسنجی نشست JwtAuthGuard/AdminJwtAuthGuard برای مصرف‌کننده‌های غیر-HTTP (گیت‌وی‌های Socket.IO).
 * قبلاً گیت‌وی‌ها فقط امضای JWT را می‌سنجیدند؛ یعنی کاربر حذف/غیرفعال‌شده یا نشست «خروج اجباری»‌شده همچنان
 * اتصال زنده‌ی پیام‌های پشتیبانی/تماس/تأیید دستیار می‌گرفت. خطا = نشست نامعتبر (فراخواننده سوکت را می‌بندد).
 */
@Injectable()
export class SessionVerifierService {
  constructor(
    private readonly jwt: JwtService,
    private readonly controlDb: ControlPrismaService,
    private readonly epoch: SessionEpochService,
  ) {}

  async verifyTenantToken(token: string): Promise<{ payload: TenantJwtPayload }> {
    const payload = await this.jwt.verifyAsync<TenantJwtPayload>(token, { algorithms: ['HS256'] });
    if (payload.type !== 'tenant_user' || !payload.tenantId) throw new Error('توکن نامعتبر است');
    const [membership, tenant] = await Promise.all([
      this.controlDb.tenantMembership.findUnique({ where: { id: payload.membershipId } }),
      this.controlDb.tenant.findUnique({ where: { id: payload.tenantId } }),
    ]);
    if (!membership || membership.status !== 'ACTIVE' || membership.tenantId !== payload.tenantId) throw new Error('دسترسی کاربر غیرفعال است');
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') throw new Error('محیط کاری غیرفعال است');
    if ((payload.tv ?? 0) < (await this.epoch.effective(tenant.tokenVersion, membership.tokenVersion))) throw new Error('نشست باطل شده است');
    return { payload: { ...payload, role: membership.role } };
  }

  async verifyAdminToken(token: string): Promise<{ payload: AdminJwtPayload }> {
    const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, { algorithms: ['HS256'] });
    if (payload.isAdmin !== true) throw new Error('توکن نامعتبر است');
    const admin = await this.controlDb.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new Error('حساب کارشناسی غیرفعال است');
    if ((payload.tv ?? 0) < (await this.epoch.effective(admin.tokenVersion))) throw new Error('نشست باطل شده است');
    // نشست محدود (تغییر رمز اجباری) به کانال‌های زنده (سوکت) دسترسی ندارد
    if (payload.mcp === true || admin.mustChangePassword) throw new Error('ابتدا رمز عبور را تغییر دهید');
    return { payload };
  }
}
