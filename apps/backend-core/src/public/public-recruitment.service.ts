import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { RECRUITMENT_MODULE_CODE, RecruitmentService } from '../recruitment/recruitment.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { fillPlaceholders } from '../common/template-placeholders.util.js';
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
    private readonly recruitment: RecruitmentService,
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
      include: {
        applicant: {
          select: {
            name: true,
            phone: true,
            jobPosting: {
              select: {
                title: true,
                contract: { select: { title: true, terms: true } },
                contractTemplate: { select: { name: true, body: true } },
              },
            },
          },
        },
      },
    });
    if (!offer) throw new NotFoundException('این لینک یافت نشد');

    const tenant = await this.controlDb.tenant.findUnique({ where: { slug }, select: { name: true } });
    const posting = offer.applicant.jobPosting;
    const templateText = posting.contractTemplate
      ? fillPlaceholders(posting.contractTemplate.body, {
          'شرکت': tenant?.name,
          'نام_شرکت': tenant?.name,
          'نام_متقاضی': offer.applicant.name,
          'نام_طرف_دوم': offer.applicant.name,
          'شماره_تماس_متقاضی': offer.applicant.phone,
          'شماره_تماس_طرف_دوم': offer.applicant.phone,
          'عنوان_شغل': posting.title,
          'شرح_وظایف': offer.jobDescription,
          'نوع_همکاری': offer.collaborationType,
          'ساعت_کاری': offer.workingHours,
          'حقوق': offer.salary.toLocaleString('fa-IR'),
          'مبلغ_قرارداد': offer.salary.toLocaleString('fa-IR'),
          'مزایا': offer.benefits,
          'مدت_قرارداد_ماه': offer.durationMonths,
          'تاریخ_شروع': offer.startDate ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'long' }).format(offer.startDate) : undefined,
        })
      : null;

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
      jobTitle: offer.applicant.jobPosting.title,
      // شرایط و قوانین همکاری (قرارداد مربوط به آگهی) — متقاضی قبل از امضا آن را می‌خواند
      contractTitle: posting.contractTemplate?.name ?? posting.contract?.title ?? null,
      contractTerms: templateText ?? posting.contract?.terms ?? null,
    };
  }

  async respondToOffer(slug: string, token: string, dto: AcceptOfferDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { publicToken: token } });
    if (!offer) throw new NotFoundException('این لینک یافت نشد');
    if (offer.status !== 'SENT') throw new BadRequestException('این شرایط همکاری در وضعیت قابل‌پاسخ نیست');

    if (!dto.accepted) {
      await ctx.tenantDb.jobOffer.update({ where: { id: offer.id }, data: { status: 'REJECTED', candidateRejectedAt: new Date() } });
      await this.recruitment.onOfferDeclined(ctx, offer.applicantId);
      return { success: true, accepted: false };
    }

    if (!dto.signature) throw new BadRequestException('برای تأیید شرایط همکاری، امضای الکترونیک لازم است');
    await ctx.tenantDb.jobOffer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', candidateAcceptedAt: new Date(), candidateSignature: dto.signature },
    });
    await this.recruitment.onOfferAccepted(ctx, offer.applicantId);
    return { success: true, accepted: true };
  }
}
