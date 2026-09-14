import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { RECRUITMENT_MODULE_CODE } from '../recruitment/recruitment.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { AcceptOfferDto } from './dto/accept-offer.dto.js';

/**
 * صفحه‌ی عمومی مشاهده/تأیید شرایط همکاری توسط متقاضی — بدون ورود، با
 * publicToken غیرقابل‌حدس (همان الگوی سایر لینک‌های عمومی این سیستم).
 */
@Injectable()
export class PublicRecruitmentService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const installed = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: RECRUITMENT_MODULE_CODE } },
    });
    if (!installed) throw new NotFoundException('این خدمت در دسترس نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async viewOffer(slug: string, token: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const offer = await ctx.tenantDb.jobOffer.findUnique({
      where: { publicToken: token },
      include: { applicant: { select: { name: true, phone: true } } },
    });
    if (!offer) throw new NotFoundException('این لینک یافت نشد');

    return {
      applicantName: offer.applicant.name,
      jobDescription: offer.jobDescription,
      collaborationType: offer.collaborationType,
      workingHours: offer.workingHours,
      salary: offer.salary,
      benefits: offer.benefits,
      durationMonths: offer.durationMonths,
      startDate: offer.startDate,
      status: offer.status,
      candidateAcceptedAt: offer.candidateAcceptedAt,
    };
  }

  async respondToOffer(slug: string, token: string, dto: AcceptOfferDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { publicToken: token } });
    if (!offer) throw new NotFoundException('این لینک یافت نشد');
    if (offer.status !== 'SENT') throw new BadRequestException('این شرایط همکاری در وضعیت قابل‌پاسخ نیست');

    if (!dto.accepted) {
      return { success: true, accepted: false };
    }

    await ctx.tenantDb.jobOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', candidateAcceptedAt: new Date() } });
    return { success: true, accepted: true };
  }
}
