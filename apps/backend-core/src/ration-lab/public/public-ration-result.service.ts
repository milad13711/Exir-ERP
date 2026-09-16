import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service.js';
import { AuthService } from '../../auth/auth.service.js';
import type { RationResultTicketPayload } from '../../auth/jwt-payload.type.js';

const RESULT_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * پورتال بدون‌حساب «نتیجه‌ی آزمایش جیره» که تننت به دامدار خودش می‌دهد —
 * ورود با شماره+OTP، دیدن نتیجه‌ی هر نمونه‌ای که به یک CrmContact با همان
 * شماره متصل است. الگوی دقیق PublicTrackingService.
 */
@Injectable()
export class PublicRationResultService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenantDb(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const tenantModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'ration-lab' } },
    });
    if (!tenantModule) throw new NotFoundException('این پورتال برای این کسب‌وکار فعال نیست');
    return this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
  }

  async requestOtp(slug: string, phone: string) {
    await this.resolveTenantDb(slug);
    return this.auth.requestOtp(phone, 'RATION_RESULT');
  }

  async verifyOtp(slug: string, phone: string, code: string): Promise<{ resultToken: string; expiresInSeconds: number }> {
    await this.resolveTenantDb(slug);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'RATION_RESULT', consumedAt: null, expiresAt: { gt: new Date() } },
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

    const payload: RationResultTicketPayload = { type: 'ration_result_ticket', phone, tenantSlug: slug };
    const resultToken = await this.jwt.signAsync(payload, { expiresIn: RESULT_TOKEN_TTL_SECONDS });
    return { resultToken, expiresInSeconds: RESULT_TOKEN_TTL_SECONDS };
  }

  private async resolveResultPhone(slug: string, resultToken: string): Promise<string> {
    let payload: RationResultTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<RationResultTicketPayload>(resultToken);
    } catch {
      throw new UnauthorizedException('نشست شما منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'ration_result_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست نامعتبر است');
    }
    return payload.phone;
  }

  async listSamples(slug: string, resultToken: string) {
    const tenantDb = await this.resolveTenantDb(slug);
    const phone = await this.resolveResultPhone(slug, resultToken);

    const contacts = await tenantDb.crmContact.findMany({ where: { phone }, select: { id: true } });
    if (contacts.length === 0) return [];

    return tenantDb.rationSample.findMany({
      where: { contactId: { in: contacts.map((c) => c.id) }, status: { in: ['SENT_TO_EXPERT', 'VIEWED_BY_FARMER'] } },
      select: { id: true, sampleNo: true, collectedAt: true, status: true },
      orderBy: { collectedAt: 'desc' },
    });
  }

  async getSample(slug: string, sampleId: string, resultToken: string) {
    const tenantDb = await this.resolveTenantDb(slug);
    const phone = await this.resolveResultPhone(slug, resultToken);

    const contacts = await tenantDb.crmContact.findMany({ where: { phone }, select: { id: true } });
    const sample = await tenantDb.rationSample.findUnique({
      where: { id: sampleId },
      include: {
        lines: true,
        labReport: true,
      },
    });
    if (!sample || !contacts.some((c) => c.id === sample.contactId) || !sample.labReport) {
      throw new NotFoundException('نتیجه‌ای برای این نمونه یافت نشد');
    }

    if (sample.status === 'SENT_TO_EXPERT') {
      await tenantDb.rationSample.update({ where: { id: sampleId }, data: { status: 'VIEWED_BY_FARMER' } });
    }

    const currentLines = sample.lines.filter((l) => l.kind === 'CURRENT');
    const proposedLines = sample.lines.filter((l) => l.kind === 'PROPOSED');
    const currentTotalCost = currentLines.reduce((sum, l) => sum + l.lineCost, 0);
    const proposedTotalCost = proposedLines.reduce((sum, l) => sum + l.lineCost, 0);

    return {
      sampleNo: sample.sampleNo,
      collectedAt: sample.collectedAt,
      report: {
        currentRationIssues: sample.labReport.currentRationIssues,
        riskIfUnchanged: sample.labReport.riskIfUnchanged,
        newRecommendations: sample.labReport.newRecommendations,
        expectedResult: sample.labReport.expectedResult,
        urgentWarningSigns: sample.labReport.urgentWarningSigns,
        submittedAt: sample.labReport.submittedAt,
      },
      economics: { currentLines, proposedLines, currentTotalCost, proposedTotalCost, delta: proposedTotalCost - currentTotalCost },
    };
  }
}
