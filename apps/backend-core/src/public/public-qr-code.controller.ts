import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { QrCodeService } from '../qr-code/qr-code.service.js';
import { isSafeRedirectUrl } from '../qr-code/qr-code-util.js';
import type { TenantRequestContext } from '../common/request-context.js';

/**
 * بدون ورود — لینک واسط کوتاهی که داخل خودِ تصویر QR رمزگذاری شده است.
 * هدف اسکن با دوربین موبایل و ریدایرکت مرورگر است (نه fetch)، پس این
 * کنترلر مستقیماً HTTP redirect برمی‌گرداند، نه JSON.
 */
@Controller('public/qr/:slug')
export class PublicQrCodeController {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrCodes: QrCodeService,
  ) {}

  @Get(':code')
  async redirect(@Param('slug') slug: string, @Param('code') code: string, @Res() res: Response) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const installed = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'qr-code' } },
    });
    if (!installed) throw new NotFoundException('این خدمت در دسترس نیست');

    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    const ctx = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;

    const targetUrl = await this.qrCodes.resolveAndTrackScan(ctx, code);
    if (!isSafeRedirectUrl(targetUrl)) throw new NotFoundException('مقصد این کد QR نامعتبر است');

    res.redirect(302, targetUrl);
  }
}
