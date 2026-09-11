import { Injectable, NotFoundException } from '@nestjs/common';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { generateQrCode } from './qr-code-util.js';
import { QrCodeImageService } from './qr-code-image.service.js';
import type { CreateQrCodeDto } from './dto/create-qr-code.dto.js';
import type { UpdateQrCodeDto } from './dto/update-qr-code.dto.js';

function apiPublicUrl(): string {
  return (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
}

/** لینک واسط عمومی که در تصویر QR رمزگذاری می‌شود — نه لینک اصلی، تا مقصد بعداً بدون چاپ دوباره قابل تغییر باشد. */
export function qrRedirectUrl(tenantSlug: string, code: string): string {
  return `${apiPublicUrl()}/public/qr/${tenantSlug}/${code}`;
}

@Injectable()
export class QrCodeService {
  constructor(private readonly image: QrCodeImageService) {}

  async list(ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.qrCode.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...r, redirectUrl: qrRedirectUrl(ctx.tenantSlug, r.code) }));
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const row = await ctx.tenantDb.qrCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('این کد QR یافت نشد');
    return { ...row, redirectUrl: qrRedirectUrl(ctx.tenantSlug, row.code) };
  }

  async create(ctx: TenantRequestContext, dto: CreateQrCodeDto) {
    const code = await generateQrCode(ctx);
    const createdByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    const row = await ctx.tenantDb.qrCode.create({
      data: { code, label: dto.label, targetUrl: dto.targetUrl, createdByUserId },
    });
    return { ...row, redirectUrl: qrRedirectUrl(ctx.tenantSlug, row.code) };
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateQrCodeDto) {
    const existing = await ctx.tenantDb.qrCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این کد QR یافت نشد');
    const row = await ctx.tenantDb.qrCode.update({ where: { id }, data: { label: dto.label, targetUrl: dto.targetUrl } });
    return { ...row, redirectUrl: qrRedirectUrl(ctx.tenantSlug, row.code) };
  }

  async remove(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.qrCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این کد QR یافت نشد');
    await ctx.tenantDb.qrCode.delete({ where: { id } });
    return { ok: true };
  }

  async imagePngBuffer(ctx: TenantRequestContext, id: string): Promise<Buffer> {
    const row = await ctx.tenantDb.qrCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('این کد QR یافت نشد');
    return this.image.toPngBuffer(qrRedirectUrl(ctx.tenantSlug, row.code));
  }

  /** فراخوانی از کنترلر عمومی — بدون احراز هویت، شمارنده‌ی اسکن را افزایش می‌دهد و مقصد را برمی‌گرداند. */
  async resolveAndTrackScan(ctx: TenantRequestContext, code: string): Promise<string> {
    const row = await ctx.tenantDb.qrCode.findUnique({ where: { code } });
    if (!row) throw new NotFoundException('این کد QR یافت نشد');
    await ctx.tenantDb.qrCode.update({ where: { id: row.id }, data: { scanCount: { increment: 1 }, lastScannedAt: new Date() } });
    return row.targetUrl;
  }
}
