import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import { AuthService } from '../../auth/auth.service.js';
import type { LabReviewTicketPayload } from '../../auth/jwt-payload.type.js';
import type { SubmitLabReportDto } from '../dto/public-lab-review.dto.js';

const LAB_REVIEW_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * پورتال بدون‌حساب «آزمایشگاه جیره» — کارشناس آزمایشگاه (بدون عضویت واقعی
 * در این تننت) با شماره‌ی خودش که در RationLabReviewer سفیدلیست شده وارد
 * می‌شود، کد نمونه را جست‌وجو می‌کند، و گزارش تخصصی + جیره‌ی پیشنهادی را
 * ثبت می‌کند. الگوی OTP→JWT-ticket دقیقاً مثل PublicTrackingService، با
 * TTL بلندتر (۶۰ دقیقه) چون بازبینی یک نمونه واقعاً زمان می‌برد.
 */
@Injectable()
export class PublicLabReviewService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenant(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'ration-lab' } },
    });
    if (!tenantModule) throw new NotFoundException('این پورتال برای این کسب‌وکار فعال نیست');
    return { tenant, tenantDb: this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName }) };
  }

  async requestOtp(slug: string, phone: string) {
    const { tenantDb } = await this.resolveTenant(slug);
    const reviewer = await tenantDb.rationLabReviewer.findUnique({ where: { phone } });
    if (!reviewer || !reviewer.isActive) {
      throw new BadRequestException('این شماره به‌عنوان کارشناس آزمایشگاه ثبت نشده است');
    }
    return this.auth.requestOtp(phone, 'LAB_REVIEW');
  }

  async verifyOtp(slug: string, phone: string, code: string): Promise<{ labToken: string; expiresInSeconds: number }> {
    await this.resolveTenant(slug);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'LAB_REVIEW', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= 5) throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const payload: LabReviewTicketPayload = { type: 'lab_review_ticket', phone, tenantSlug: slug };
    const labToken = await this.jwt.signAsync(payload, { expiresIn: LAB_REVIEW_TOKEN_TTL_SECONDS });
    return { labToken, expiresInSeconds: LAB_REVIEW_TOKEN_TTL_SECONDS };
  }

  private async resolveLabPhone(slug: string, labToken: string): Promise<string> {
    let payload: LabReviewTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<LabReviewTicketPayload>(labToken);
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده، دوباره کد را تأیید کنید');
    }
    if (payload.type !== 'lab_review_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست نامعتبر است');
    }
    return payload.phone;
  }

  async searchSample(slug: string, labToken: string, sampleCode: string) {
    const { tenantDb } = await this.resolveTenant(slug);
    await this.resolveLabPhone(slug, labToken);

    const sample = await tenantDb.rationSample.findUnique({
      where: { sampleCode },
      include: {
        contact: { select: { name: true, phone: true } },
        lines: { where: { kind: 'CURRENT' } },
        labReport: true,
      },
    });
    if (!sample) throw new NotFoundException('نمونه‌ای با این کد یافت نشد');
    if (sample.labReport) throw new BadRequestException('گزارش این نمونه قبلاً ثبت شده است');

    return {
      id: sample.id,
      sampleCode: sample.sampleCode,
      collectedAt: sample.collectedAt,
      herdSize: sample.herdSize,
      totalHerdMilkYieldLiters: sample.totalHerdMilkYieldLiters,
      avgMilkYieldPerAnimalLiters: sample.avgMilkYieldPerAnimalLiters,
      milkFatPercent: sample.milkFatPercent,
      milkProteinPercent: sample.milkProteinPercent,
      currentRationDescription: sample.currentRationDescription,
      currentLines: sample.lines,
      // بدون هویت دامدار وقتی تننت این نمونه‌ی خاص را محدود کرده باشد.
      contact: sample.isIdentityVisibleToLab ? sample.contact : null,
    };
  }

  async submitReport(slug: string, sampleId: string, dto: SubmitLabReportDto) {
    const { tenantDb } = await this.resolveTenant(slug);
    const phone = await this.resolveLabPhone(slug, dto.labToken);

    const sample = await tenantDb.rationSample.findUnique({ where: { id: sampleId }, include: { labReport: true } });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (sample.labReport) throw new BadRequestException('گزارش این نمونه قبلاً ثبت شده است');

    let knowledgeReportId: string | null = null;
    if (dto.addToKnowledge) {
      const knowledgeReport = await tenantDb.report.create({
        data: {
          title: `توصیه‌ی جیره — نمونه ${sample.sampleCode}`,
          body: [
            `ایرادات جیره‌ی فعلی: ${dto.currentRationIssues}`,
            `ریسک عدم تغییر: ${dto.riskIfUnchanged}`,
            `توصیه‌های جدید: ${dto.newRecommendations}`,
            `نتیجه‌ی قابل انتظار: ${dto.expectedResult}`,
          ].join('\n\n'),
          isKnowledge: true,
        },
      });
      knowledgeReportId = knowledgeReport.id;
    }

    await tenantDb.rationLabReport.create({
      data: {
        sampleId,
        reviewedByPhone: phone,
        reviewedByName: dto.reviewedByName,
        currentRationIssues: dto.currentRationIssues,
        riskIfUnchanged: dto.riskIfUnchanged,
        newRecommendations: dto.newRecommendations,
        expectedResult: dto.expectedResult,
        urgentWarningSigns: dto.urgentWarningSigns,
        isKnowledge: Boolean(dto.addToKnowledge),
        knowledgeReportId,
      },
    });

    if (dto.proposedLines.length > 0) {
      await tenantDb.rationFormulaLine.createMany({
        data: dto.proposedLines.map((l) => ({
          sampleId,
          kind: 'PROPOSED',
          ingredientName: l.ingredientName,
          quantityPerAnimalKg: l.quantityPerAnimalKg,
          unitCostSnapshot: l.unitCostSnapshot,
          lineCost: Math.round(l.quantityPerAnimalKg * l.unitCostSnapshot),
        })),
      });
    }

    if (dto.attachmentUrls?.length) {
      await tenantDb.attachment.createMany({
        data: dto.attachmentUrls.map((url, i) => ({
          entityType: 'ration_sample',
          entityId: sampleId,
          title: `مستند آزمایشگاه ${i + 1}`,
          fileUrl: url,
        })),
      });
    }

    const submittedAt = new Date();
    await tenantDb.rationSample.update({ where: { id: sampleId }, data: { status: 'LAB_REVIEWED' } });
    await tenantDb.rationFollowUpCheckin.createMany({
      data: [7, 14, 30].map((days) => {
        const scheduledAt = new Date(submittedAt);
        scheduledAt.setDate(scheduledAt.getDate() + days);
        return { sampleId, dueOffsetDays: days, scheduledAt };
      }),
    });

    return { success: true };
  }
}
