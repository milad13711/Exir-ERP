import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateJobPostingDto } from './dto/create-job-posting.dto.js';
import type { UpdateJobPostingDto } from './dto/update-job-posting.dto.js';
import type { CreateApplicantDto } from './dto/create-applicant.dto.js';
import type { UpdateApplicantDto } from './dto/update-applicant.dto.js';
import type { DecisionDto } from './dto/decision.dto.js';
import type { ScheduleInterviewDto } from './dto/schedule-interview.dto.js';
import type { UpdateInterviewDto } from './dto/update-interview.dto.js';
import type { RecordInterviewReportDto } from './dto/record-interview-report.dto.js';
import type { CreateOfferDto } from './dto/create-offer.dto.js';
import type { HireApplicantDto } from './dto/hire-applicant.dto.js';
import type { UpdateRecruitmentGeneralSettingsDto, UpdateRecruitmentSmsSettingsDto } from './dto/update-settings.dto.js';

export const RECRUITMENT_MODULE_CODE = 'recruitment';
const GENERAL_KEY = { moduleCode: RECRUITMENT_MODULE_CODE, key: 'general' } as const;
const SMS_KEY = { moduleCode: RECRUITMENT_MODULE_CODE, key: 'sms' } as const;
const SEAL_KEY = { moduleCode: RECRUITMENT_MODULE_CODE, key: 'companySeal' } as const;

type GeneralSettings = { defaultInterviewMinutes: number; bufferMinutesBetweenInterviews: number };
const DEFAULT_GENERAL: GeneralSettings = { defaultInterviewMinutes: 30, bufferMinutesBetweenInterviews: 10 };

type SmsSettings = {
  enabled: boolean;
  specialistApprovedTemplate: string;
  specialistRejectedTemplate: string;
  managementApprovedTemplate: string;
  managementRejectedTemplate: string;
  interviewInvitationTemplate: string;
};
const DEFAULT_SMS: SmsSettings = {
  enabled: false,
  specialistApprovedTemplate: 'متقاضی گرامی {name}، رزومه‌ی شما توسط کارشناس بررسی و تأیید شد و وارد مرحله‌ی تأیید نهایی مدیریت شد.',
  specialistRejectedTemplate: 'متقاضی گرامی {name}، با تشکر از وقتی که گذاشتید، در این مرحله امکان ادامه‌ی همکاری فراهم نشد.',
  managementApprovedTemplate: 'متقاضی گرامی {name}، تبریک! همکاری شما توسط مدیریت تأیید نهایی شد.',
  managementRejectedTemplate: 'متقاضی گرامی {name}، با تشکر از وقتی که گذاشتید، در این دوره امکان جذب شما فراهم نشد.',
  interviewInvitationTemplate: 'متقاضی گرامی {name}، جلسه‌ی مصاحبه‌ی شما در تاریخ {date} ساعت {time} برگزار می‌شود.',
};

type CompanySeal = { signatureImage?: string; stampImage?: string };

const APPLICANT_INCLUDE = {
  jobPosting: { select: { id: true, title: true, postingNo: true } },
  specialist: { select: { id: true, name: true } },
  management: { select: { id: true, name: true } },
  interviews: { include: { interviewer: { select: { id: true, name: true } }, scoreItems: true }, orderBy: { scheduledAt: 'desc' as const } },
  offer: true,
} as const;

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, val);
  return out;
}

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly sms: ExirSmsService,
    private readonly automation: AutomationEngineService,
  ) {}

  /* ───────────────────────── تنظیمات ───────────────────────── */

  async getGeneralSettings(ctx: TenantRequestContext): Promise<GeneralSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: GENERAL_KEY } });
    return row ? { ...DEFAULT_GENERAL, ...(row.value as Partial<GeneralSettings>) } : DEFAULT_GENERAL;
  }

  async setGeneralSettings(ctx: TenantRequestContext, dto: UpdateRecruitmentGeneralSettingsDto): Promise<GeneralSettings> {
    const value = { ...dto };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: GENERAL_KEY }, update: { value }, create: { ...GENERAL_KEY, value } });
    return this.getGeneralSettings(ctx);
  }

  async getSmsSettings(ctx: TenantRequestContext): Promise<SmsSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SMS_KEY } });
    return row ? { ...DEFAULT_SMS, ...(row.value as Partial<SmsSettings>) } : DEFAULT_SMS;
  }

  async setSmsSettings(ctx: TenantRequestContext, dto: UpdateRecruitmentSmsSettingsDto): Promise<SmsSettings> {
    const value = { ...dto };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SMS_KEY }, update: { value }, create: { ...SMS_KEY, value } });
    return this.getSmsSettings(ctx);
  }

  async getCompanySeal(ctx: TenantRequestContext): Promise<CompanySeal> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SEAL_KEY } });
    return (row?.value as CompanySeal | undefined) ?? {};
  }

  async setCompanySeal(ctx: TenantRequestContext, dto: CompanySeal): Promise<CompanySeal> {
    const existing = await this.getCompanySeal(ctx);
    const value = { signatureImage: dto.signatureImage ?? existing.signatureImage, stampImage: dto.stampImage ?? existing.stampImage };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SEAL_KEY }, update: { value }, create: { ...SEAL_KEY, value } });
    return value;
  }

  /* ───────────────────────── آگهی‌ها ───────────────────────── */

  async listPostings(ctx: TenantRequestContext, status?: string) {
    const postings = await ctx.tenantDb.jobPosting.findMany({
      where: status ? { status: status as never } : {},
      include: { _count: { select: { applicants: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return postings;
  }

  async postingDetail(ctx: TenantRequestContext, id: string) {
    const posting = await ctx.tenantDb.jobPosting.findUnique({
      where: { id },
      include: { applicants: { include: APPLICANT_INCLUDE, orderBy: { createdAt: 'desc' } } },
    });
    if (!posting) throw new NotFoundException('این آگهی یافت نشد');
    return posting;
  }

  async createPosting(ctx: TenantRequestContext, dto: CreateJobPostingDto) {
    const createdByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    return ctx.tenantDb.jobPosting.create({ data: { ...dto, createdByUserId } });
  }

  async updatePosting(ctx: TenantRequestContext, id: string, dto: UpdateJobPostingDto) {
    const existing = await ctx.tenantDb.jobPosting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این آگهی یافت نشد');
    return ctx.tenantDb.jobPosting.update({ where: { id }, data: dto });
  }

  async closePosting(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.jobPosting.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این آگهی یافت نشد');
    return ctx.tenantDb.jobPosting.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
  }

  /** گزارش پایان فرآیند جذب یک آگهی — قیف مراحل + نتیجه‌ی نهایی. */
  async postingReport(ctx: TenantRequestContext, id: string) {
    const posting = await this.postingDetail(ctx, id);
    const stageBreakdown: Record<string, number> = {};
    for (const a of posting.applicants) stageBreakdown[a.stage] = (stageBreakdown[a.stage] ?? 0) + 1;
    const hired = posting.applicants.filter((a) => a.stage === 'HIRED').length;

    return {
      postingId: posting.id,
      title: posting.title,
      capacity: posting.capacity,
      totalApplicants: posting.applicants.length,
      hired,
      remainingCapacity: Math.max(0, posting.capacity - hired),
      stageBreakdown,
      status: posting.status,
      closedAt: posting.closedAt,
    };
  }

  /* ───────────────────────── متقاضیان ───────────────────────── */

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name, phone, source: 'متقاضی استخدام' } });
  }

  async listApplicants(ctx: TenantRequestContext, filters: { jobPostingId?: string; stage?: string; search?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.jobPostingId) where.jobPostingId = filters.jobPostingId;
    if (filters.stage) where.stage = filters.stage;
    if (filters.search) {
      const term = filters.search.trim();
      where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }];
    }
    return ctx.tenantDb.jobApplicant.findMany({ where, include: APPLICANT_INCLUDE, orderBy: { createdAt: 'desc' } });
  }

  async applicantDetail(ctx: TenantRequestContext, id: string) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id }, include: APPLICANT_INCLUDE });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    return applicant;
  }

  async createApplicant(ctx: TenantRequestContext, dto: CreateApplicantDto) {
    const contact = await this.resolveOrCreateContact(ctx, dto.name, dto.phone);
    return ctx.tenantDb.jobApplicant.create({
      data: {
        jobPostingId: dto.jobPostingId,
        name: dto.name,
        phone: dto.phone,
        educationField: dto.educationField,
        skillTags: dto.skillTags ?? [],
        resumeFile: dto.resumeFile,
        contactId: contact.id,
      },
      include: APPLICANT_INCLUDE,
    });
  }

  async updateApplicant(ctx: TenantRequestContext, id: string, dto: UpdateApplicantDto) {
    const existing = await ctx.tenantDb.jobApplicant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این متقاضی یافت نشد');
    return ctx.tenantDb.jobApplicant.update({ where: { id }, data: dto, include: APPLICANT_INCLUDE });
  }

  async specialistDecision(ctx: TenantRequestContext, id: string, dto: DecisionDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    const specialistUserId = await resolveTenantUserId(ctx).catch(() => undefined);

    const updated = await ctx.tenantDb.jobApplicant.update({
      where: { id },
      data: {
        stage: dto.approved ? 'SPECIALIST_APPROVED' : 'SPECIALIST_REJECTED',
        specialistDecisionReason: dto.reason,
        specialistDecisionAt: new Date(),
        specialistUserId,
      },
      include: APPLICANT_INCLUDE,
    });

    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled) {
      const template = dto.approved ? settings.specialistApprovedTemplate : settings.specialistRejectedTemplate;
      await this.sms.sendSms(applicant.phone, renderTemplate(template, { name: applicant.name }));
    }
    return updated;
  }

  async managementDecision(ctx: TenantRequestContext, id: string, dto: DecisionDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    if (applicant.stage !== 'SPECIALIST_APPROVED') {
      throw new BadRequestException('این متقاضی هنوز توسط کارشناس تأیید نشده است');
    }
    const managementUserId = await resolveTenantUserId(ctx).catch(() => undefined);

    const updated = await ctx.tenantDb.jobApplicant.update({
      where: { id },
      data: {
        stage: dto.approved ? 'MANAGEMENT_APPROVED' : 'MANAGEMENT_REJECTED',
        managementDecisionReason: dto.reason,
        managementDecisionAt: new Date(),
        managementUserId,
      },
      include: APPLICANT_INCLUDE,
    });

    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled) {
      const template = dto.approved ? settings.managementApprovedTemplate : settings.managementRejectedTemplate;
      await this.sms.sendSms(applicant.phone, renderTemplate(template, { name: applicant.name }));
    }
    return updated;
  }

  /* ───────────────────────── مصاحبه‌ها ───────────────────────── */

  async listInterviews(ctx: TenantRequestContext, filters: { from?: string; to?: string; interviewerUserId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.from || filters.to) {
      where.scheduledAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    if (filters.interviewerUserId) where.interviewerUserId = filters.interviewerUserId;

    return ctx.tenantDb.jobInterview.findMany({
      where,
      include: {
        interviewer: { select: { id: true, name: true } },
        applicant: { select: { id: true, name: true, phone: true, jobPosting: { select: { title: true } } } },
        scoreItems: true,
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async scheduleInterview(ctx: TenantRequestContext, dto: ScheduleInterviewDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id: dto.applicantId } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');

    const general = await this.getGeneralSettings(ctx);
    const durationMinutes = dto.durationMinutes ?? general.defaultInterviewMinutes;

    const interview = await ctx.tenantDb.jobInterview.create({
      data: {
        applicantId: dto.applicantId,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes,
        interviewerUserId: dto.interviewerUserId,
      },
      include: { interviewer: { select: { id: true, name: true } } },
    });

    await ctx.tenantDb.jobApplicant.update({ where: { id: dto.applicantId }, data: { stage: 'INTERVIEW_SCHEDULED' } });

    if (dto.interviewerUserId) {
      await ctx.tenantDb.task.create({
        data: {
          title: `مصاحبه‌ی استخدامی با ${applicant.name}`,
          dueAt: interview.scheduledAt,
          priority: 'MEDIUM',
          assignedUserId: dto.interviewerUserId,
          relatedModule: RECRUITMENT_MODULE_CODE,
          relatedEntityId: interview.id,
        },
      });
    }

    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled && settings.interviewInvitationTemplate) {
      const message = renderTemplate(settings.interviewInvitationTemplate, {
        name: applicant.name,
        date: interview.scheduledAt.toLocaleDateString('fa-IR'),
        time: interview.scheduledAt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      });
      await this.sms.sendSms(applicant.phone, message);
    }

    return interview;
  }

  async updateInterview(ctx: TenantRequestContext, id: string, dto: UpdateInterviewDto) {
    const existing = await ctx.tenantDb.jobInterview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این مصاحبه یافت نشد');
    return ctx.tenantDb.jobInterview.update({
      where: { id },
      data: { ...dto, scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined },
      include: { interviewer: { select: { id: true, name: true } } },
    });
  }

  async cancelInterview(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.jobInterview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این مصاحبه یافت نشد');
    return ctx.tenantDb.jobInterview.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  async recordInterviewReport(ctx: TenantRequestContext, id: string, dto: RecordInterviewReportDto) {
    const existing = await ctx.tenantDb.jobInterview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این مصاحبه یافت نشد');

    await ctx.tenantDb.jobInterviewScore.deleteMany({ where: { interviewId: id } });
    await ctx.tenantDb.jobInterview.update({
      where: { id },
      data: {
        status: dto.status,
        overallNote: dto.overallNote,
        scoreItems: { create: dto.scores.map((s) => ({ criterion: s.criterion, score: s.score, note: s.note })) },
      },
    });

    if (dto.status === 'DONE') {
      await ctx.tenantDb.jobApplicant.update({ where: { id: existing.applicantId }, data: { stage: 'INTERVIEWED' } });
    }

    return ctx.tenantDb.jobInterview.findUnique({ where: { id }, include: { scoreItems: true, interviewer: { select: { id: true, name: true } } } });
  }

  /* ───────────────────────── شرایط همکاری (پیشنهاد) ───────────────────────── */

  async createOrUpdateOffer(ctx: TenantRequestContext, applicantId: string, dto: CreateOfferDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id: applicantId } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    if (applicant.stage !== 'MANAGEMENT_APPROVED') {
      throw new BadRequestException('فقط برای متقاضی تأییدشده توسط مدیریت می‌توان شرایط همکاری تعیین کرد');
    }

    return ctx.tenantDb.jobOffer.upsert({
      where: { applicantId },
      create: {
        applicantId,
        jobDescription: dto.jobDescription,
        collaborationType: dto.collaborationType,
        workingHours: dto.workingHours,
        salary: dto.salary,
        benefits: dto.benefits,
        durationMonths: dto.durationMonths,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      },
      update: {
        jobDescription: dto.jobDescription,
        collaborationType: dto.collaborationType,
        workingHours: dto.workingHours,
        salary: dto.salary,
        benefits: dto.benefits,
        durationMonths: dto.durationMonths,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      },
    });
  }

  async sendOffer(ctx: TenantRequestContext, offerId: string) {
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('این شرایط همکاری یافت نشد');
    return ctx.tenantDb.jobOffer.update({ where: { id: offerId }, data: { status: 'SENT' } });
  }

  async signOffer(ctx: TenantRequestContext, offerId: string) {
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('این شرایط همکاری یافت نشد');
    if (offer.status !== 'ACCEPTED') throw new BadRequestException('فقط پس از تأیید متقاضی، مدیر می‌تواند امضا کند');
    const signedByUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    return ctx.tenantDb.jobOffer.update({ where: { id: offerId }, data: { status: 'SIGNED', signedByUserId, signedAt: new Date() } });
  }

  async getOfferForApplicant(ctx: TenantRequestContext, applicantId: string) {
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { applicantId } });
    if (!offer) throw new NotFoundException('برای این متقاضی شرایط همکاری‌ای ثبت نشده است');
    return offer;
  }

  /* ───────────────────────── جذب نهایی → HR ───────────────────────── */

  async hireApplicant(ctx: TenantRequestContext, applicantId: string, dto: HireApplicantDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id: applicantId }, include: { offer: true, jobPosting: true } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    if (applicant.stage !== 'MANAGEMENT_APPROVED') throw new BadRequestException('این متقاضی توسط مدیریت تأیید نشده است');
    if (!applicant.offer || applicant.offer.status !== 'SIGNED') throw new BadRequestException('ابتدا باید شرایط همکاری توسط متقاضی تأیید و توسط مدیر امضا شود');

    const employee = await ctx.tenantDb.employee.create({
      data: {
        employeeCode: dto.employeeCode,
        fullName: applicant.name,
        phone: applicant.phone,
        position: applicant.jobPosting.title,
        department: dto.department,
        hireDate: applicant.offer.startDate ?? new Date(),
        baseSalary: applicant.offer.salary,
        status: 'ACTIVE',
      },
    });

    await ctx.tenantDb.employeeDocument.create({
      data: {
        employeeId: employee.id,
        type: 'CONTRACT',
        title: `قرارداد همکاری — ${applicant.name}`,
        fileUrl: `/recruitment/offers/${applicant.offer.id}/pdf`,
      },
    });

    await ctx.tenantDb.jobApplicant.update({ where: { id: applicantId }, data: { stage: 'HIRED' } });
    await this.automation.emit(ctx, 'recruitment.applicant.hired', { applicantName: applicant.name, jobTitle: applicant.jobPosting.title });

    return employee;
  }
}
