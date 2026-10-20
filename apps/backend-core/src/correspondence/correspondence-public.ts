import { Controller, Get, Header, HttpException, Injectable, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { throttleKey } from '../licensing/license-throttle.js';
import { clientIp } from '../security/client-ip.js';
import { isWellFormedToken, hashVerifyToken } from './verify-token.js';

export type PublicVerifyResult = {
  valid: boolean;
  letterNumber: string | null;
  date: string | null;
  signerName: string | null;
  issuerOrg: string | null;
  status: 'ACTIVE' | 'VOID' | null;
};
const INVALID: PublicVerifyResult = { valid: false, letterNumber: null, date: null, signerName: null, issuerOrg: null, status: null };

/** محدودکننده‌ی ساده‌ی نرخ به‌ازای IP (پنجره‌ی ثابت، درون‌حافظه، اندازه‌ی سخت). */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { n: number; reset: number }>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly cap = 20_000) {}
  allow(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) {
      if (this.hits.size >= this.cap) {
        let n = Math.ceil(this.cap * 0.1);
        for (const k of this.hits.keys()) { this.hits.delete(k); if (--n <= 0) break; }
      }
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    cur.n += 1;
    return cur.n <= this.max;
  }
}

const dayText = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * صحت‌سنجی عمومی نامه با QR — فقط {valid, letterNumber, date, signerName, issuerOrg, status}؛ هرگز موضوع/متن/گیرنده.
 * توکن ۲۵۶بیتی غیرقابل‌حدس؛ هر پاسخ ناموفق (تننت ناشناخته، توکن نامعتبر، ماژول نصب‌نشده) دقیقاً یکسان است تا شمارش ممکن نشود.
 */
@Injectable()
export class CorrespondencePublicService {
  private readonly limiter = new FixedWindowLimiter(60, 10 * 60_000);

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  allow(ip: string): boolean {
    return this.limiter.allow(ip);
  }

  /** حداقل زمان پاسخ: تننت/توکن ناشناس و معتبر از روی زمان قابل تشخیص نباشد (جلوگیری از شمارش slug). */
  static readonly MIN_RESPONSE_MS = 80;

  async verify(slug: string, token: string): Promise<PublicVerifyResult> {
    const started = Date.now();
    try {
      return await this.verifyInner(slug, token);
    } finally {
      const wait = CorrespondencePublicService.MIN_RESPONSE_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async verifyInner(slug: string, token: string): Promise<PublicVerifyResult> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug) || !isWellFormedToken(token)) return INVALID;
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') return INVALID;
    const installed = await this.controlDb.tenantModule.findFirst({ where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'correspondence' } }, select: { id: true } });
    if (!installed) return INVALID;
    const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    const l = await db.corrLetter.findUnique({
      where: { verifyTokenHash: hashVerifyToken(token) },
      select: { letterNumber: true, status: true, type: true, signedAt: true, registeredAt: true, letterDate: true, signerName: true, issuedAt: true },
    });
    if (!l || !l.letterNumber) return INVALID;
    const void_ = l.status === 'VOID';
    // پیش از امضا (در انتظار امضا با شماره‌ی رزروشده) اعتبار ندارد
    const issued = l.type === 'INCOMING' ? true : !!l.signedAt;
    if (!issued) return INVALID;
    return {
      valid: !void_, letterNumber: l.letterNumber, date: dayText(l.type === 'INCOMING' ? l.registeredAt : l.letterDate ?? l.issuedAt),
      signerName: l.type === 'INCOMING' ? null : l.signerName, issuerOrg: tenant.name, status: void_ ? 'VOID' : 'ACTIVE',
    };
  }
}

@Controller('public/correspondence/verify')
export class CorrespondencePublicController {
  constructor(private readonly service: CorrespondencePublicService) {}

  @Get(':slug/:token')
  @Header('Cache-Control', 'no-store')
  async verify(@Param('slug') slug: string, @Param('token') token: string, @Req() req: Request): Promise<PublicVerifyResult> {
    if (!this.service.allow(throttleKey(clientIp(req) || 'unknown'))) throw new HttpException('تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید', 429);
    return this.service.verify(slug, token);
  }
}
