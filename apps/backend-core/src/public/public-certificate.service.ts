import { Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { CertificateImageService } from '../hr/certificate-image.service.js';
import { certificateVerifyUrl } from '../hr/certificates.controller.js';
import type { TenantRequestContext } from '../common/request-context.js';

const SEAL_KEY = { moduleCode: 'contracts', key: 'companySignature' } as const;

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
    private readonly image: CertificateImageService,
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
      include: { employee: { select: { fullName: true } } },
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
      courseTitleFa: cert.courseTitleFa,
      courseTitleEn: cert.courseTitleEn,
      durationHours: cert.durationHours,
      startDate: cert.startDate,
      endDate: cert.endDate,
      score: cert.score,
      issuedAt: cert.createdAt,
      organizationName: tenant.name,
      verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code),
    };
  }

  async renderImage(slug: string, code: string): Promise<Buffer> {
    const ctx = await this.resolveTenantCtx(slug);
    const [tenant, cert, sealRow] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { slug } }),
      this.findByCode(ctx, code),
      ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SEAL_KEY } }),
    ]);
    const seal = (sealRow?.value as { signatureImage?: string; stampImage?: string } | undefined) ?? {};
    return this.image.render(cert, tenant.name, certificateVerifyUrl(ctx.tenantSlug, cert.code), seal);
  }
}
