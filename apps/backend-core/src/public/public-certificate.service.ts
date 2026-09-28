import { Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { CertificateRenderService, type CertificateForRender } from '../certificates/certificate-render.service.js';
import { CertificateTemplateSettingsService } from '../certificates/certificate-template-settings.service.js';
import { certificateVerifyUrl } from '../certificates/certificate-verify-url.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import type { TenantRequestContext } from '../common/request-context.js';

function toRenderModel(cert: {
  code: string;
  recipientNameFa: string;
  recipientNameEn: string | null;
  titleFa: string;
  titleEn: string | null;
  durationHours: number | null;
  startDate: Date | null;
  endDate: Date | null;
  score: number | null;
  issuedByName: string | null;
  createdAt: Date;
  items: { titleFa: string; titleEn: string | null }[];
}): CertificateForRender {
  return { ...cert };
}

function parseLang(value: string | undefined): 'fa' | 'en' {
  return value === 'en' ? 'en' : 'fa';
}

/**
 * صفحه‌ی عمومی استعلام گواهی — بدون ورود، بدون OTP، بدون توکن جداگانه.
 * کد ۱۰ کاراکتری خودِ گواهی هم شناسه‌ی یکتا و هم کلید لینک دائمی است
 * (برخلاف publicToken در سایر ماژول‌ها که قابل ابطال/چرخش است) چون
 * گواهی یک سند اثبات صدور دائمی است و کاربر گفته «لینک هیچوقت اکسپایر نشه».
 */
@Injectable()
export class PublicCertificateService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly render: CertificateRenderService,
    private readonly templateSettings: CertificateTemplateSettingsService,
    private readonly stamp: CompanyStampService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  private async findByCode(ctx: TenantRequestContext, code: string) {
    const cert = await ctx.tenantDb.certificate.findUnique({
      where: { code: code.trim().toUpperCase() },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    if (!cert) throw new NotFoundException('گواهی با این کد یافت نشد');
    return cert;
  }

  async lookup(slug: string, code: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { slug } });
    const cert = await this.findByCode(ctx, code);
    return {
      code: cert.code,
      recipientNameFa: cert.recipientNameFa,
      recipientNameEn: cert.recipientNameEn,
      titleFa: cert.titleFa,
      titleEn: cert.titleEn,
      items: cert.items,
      durationHours: cert.durationHours,
      startDate: cert.startDate,
      endDate: cert.endDate,
      score: cert.score,
      issuedAt: cert.createdAt,
      issuedByName: cert.issuedByName,
      organizationName: tenant.name,
      verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code),
    };
  }

  private async renderBuffer(slug: string, code: string, lang: string | undefined, kind: 'png' | 'pdf'): Promise<Buffer> {
    const ctx = await this.resolveTenantCtx(slug);
    const [tenant, cert, seal, settings] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { slug } }),
      this.findByCode(ctx, code),
      this.stamp.getStamp(ctx),
      this.templateSettings.get(ctx),
    ]);
    const model = toRenderModel(cert);
    const verifyUrl = certificateVerifyUrl(ctx.tenantSlug, cert.code);
    const language = parseLang(lang);
    return kind === 'png'
      ? this.render.renderPng(model, language, tenant.name, verifyUrl, settings, seal)
      : this.render.renderPdf(model, language, tenant.name, verifyUrl, settings, seal);
  }

  async renderImage(slug: string, code: string, lang?: string): Promise<Buffer> {
    return this.renderBuffer(slug, code, lang, 'png');
  }

  async renderPdf(slug: string, code: string, lang?: string): Promise<Buffer> {
    return this.renderBuffer(slug, code, lang, 'pdf');
  }
}
