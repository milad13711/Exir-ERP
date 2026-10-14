import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { DispatchReceiptService } from './dispatch-receipt.service.js';
import { SignReceiptDto } from './dto/dispatch.dto.js';

/**
 * رسید راننده — بدون ورود و بدون OTP، دقیقاً مثل لینک پیشنهاد بار ناوگان: خودِ توکن یکتا و غیرقابل‌حدس
 * (DispatchReceipt.publicToken) تنها کنترل دسترسی است؛ بدنه‌ی POST شواهد امضا (IP، دستگاه، موقعیت) را هم می‌گیرد.
 */
@Injectable()
export class PublicDispatchReceiptService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly receipts: DispatchReceiptService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') throw new NotFoundException('این لینک دیگر معتبر نیست');
    const installed = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'dispatch' } },
    });
    if (!installed) throw new NotFoundException('این لینک دیگر معتبر نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async view(slug: string, token: string) {
    return this.receipts.publicView(await this.resolveCtx(slug), token);
  }

  async sign(slug: string, token: string, dto: SignReceiptDto, req: Request) {
    return this.receipts.publicSign(await this.resolveCtx(slug), token, dto, req);
  }
}

@Controller('public/dispatch/receipt/:slug/:token')
export class PublicDispatchReceiptController {
  constructor(private readonly service: PublicDispatchReceiptService) {}

  @Get()
  view(@Param('slug') slug: string, @Param('token') token: string) {
    return this.service.view(slug, token);
  }

  @Post('sign')
  sign(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: SignReceiptDto, @Req() req: Request) {
    return this.service.sign(slug, token, dto, req);
  }
}
