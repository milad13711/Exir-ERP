import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { faDate, faTime } from '../common/persian.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { UsersService } from '../users/users.service.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
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

type GeneralSettings = { defaultInterviewMinutes: number; bufferMinutesBetweenInterviews: number };
const DEFAULT_GENERAL: GeneralSettings = { defaultInterviewMinutes: 30, bufferMinutesBetweenInterviews: 10 };

type SmsSettings = {
  enabled: boolean;
  specialistApprovedTemplate: string;
  specialistRejectedTemplate: string;
  managementApprovedTemplate: string;
  managementRejectedTemplate: string;
  interviewInvitationTemplate: string;
  offerSentTemplate: string;
  hiredTemplate: string;
};
// پیش‌فرض روشن: وقتی مدیر هرگز تنظیمات پیامک این ماژول را ذخیره نکرده، انتظار دارد پیام‌ها ارسال شوند (خاموش‌کردن صریح از تنظیمات ممکن است)
const DEFAULT_SMS: SmsSettings = {
  enabled: true,
  specialistApprovedTemplate: 'متقاضی گرامی {name}، رزومه‌ی شما توسط کارشناس بررسی و تأیید شد و وارد مرحله‌ی تأیید نهایی مدیریت شد.',
  specialistRejectedTemplate: 'متقاضی گرامی {name}، با تشکر از وقتی که گذاشتید، در این مرحله امکان ادامه‌ی همکاری فراهم نشد.',
  managementApprovedTemplate: 'متقاضی گرامی {name}، تبریک! همکاری شما توسط مدیریت تأیید نهایی شد.',
  managementRejectedTemplate: 'متقاضی گرامی {name}، با تشکر از وقتی که گذاشتید، در این دوره امکان جذب شما فراهم نشد.',
  interviewInvitationTemplate: 'متقاضی گرامی {name}، جلسه‌ی مصاحبه‌ی شما در تاریخ {date} ساعت {time} در {location} برگزار می‌شود.',
  offerSentTemplate: 'متقاضی گرامی {name}، شرایط همکاری شما تعیین شد. لطفاً از لینک زیر شرایط را مشاهده و تأیید کنید: {link}',
  hiredTemplate: 'متقاضی گرامی {name}، تبریک! همکاری شما نهایی شد. شماره پرسنلی شما {employeeCode} و واحد فعالیت شما {department} است.',
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
export class RecruitmentService implements OnModuleInit {
  constructor(
    private readonly sms: TenantSmsService,
    private readonly automation: AutomationEngineService,
    private readonly users: UsersService,
    private readonly stamp: CompanyStampService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // تأیید نهایی متقاضی از کارتابل مدیر — همان مسیر hire با پیش‌فرض‌ها (شماره‌ی پرسنلی خودکار، بدون تغییر واحد).
    this.approvals.registerHandler('JOB_APPLICANT', {
      approve: async (ctx, id, opts) => {
        await this.hireApplicant(ctx, id, { applyStamp: opts.stampApplied }, { fromApprovals: true });
      },
      reject: async (ctx, id, opts) => {
        await this.managementDecision(ctx, id, { approved: false, reason: opts.note }, { fromApprovals: true });
      },
      describe: async (ctx, id) => {
        const a = await ctx.tenantDb.jobApplicant.findUniqueOrThrow({ where: { id }, include: { jobPosting: true, offer: true } });
        const o = a.offer;
        const fields = [
          { label: 'متقاضی', value: `${a.name} — ${a.phone}` },
          { label: 'آگهی', value: `${a.jobPosting.title} (ظرفیت ${a.jobPosting.capacity} نفر)` },
          { label: 'رشته/مهارت‌ها', value: [a.educationField, a.skillTags.join('، ')].filter(Boolean).join(' — ') || '—' },
          { label: 'تأیید کارشناس', value: a.specialistDecisionReason ?? 'تأیید شده' },
        ];
        if (o) {
          fields.push(
            { label: 'شرح وظایف', value: o.jobDescription },
            { label: 'نحوه‌ی همکاری', value: o.collaborationType },
            { label: 'ساعت حضور روزانه', value: o.workingHours ?? '—' },
            { label: 'حقوق ماهانه', value: `${o.salary.toLocaleString('en-US')} تومان` },
            { label: 'مدت همکاری', value: o.durationMonths ? `${o.durationMonths} ماه` : 'نامحدود' },
            { label: 'امضای متقاضی', value: o.candidateSignature ? 'ثبت شده ✓' : 'ثبت نشده' },
          );
        }
        return { fields };
      },
    });
  }

  private assertManager(ctx: TenantRequestContext): void {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('تأیید نهایی فقط توسط مالک یا مدیر انجام می‌شود، نه کارشناسان');
    }
  }

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

  /** مهر/امضای رسمی شرکت — از منبع مرکزی (Settings → General)؛ این ماژول دیگر نسخه‌ی جدا و بارگذاری‌شدنی خودش را ندارد. */
  getCompanySeal(ctx: TenantRequestContext): Promise<CompanySeal> {
    return this.stamp.getStamp(ctx);
  }

  /** آدرس پیش‌فرض محل مصاحبه — همان آدرس شرکت در تنظیمات عمومی (Settings → General)، بدون تنظیم تکراری برای این ماژول. */
  private async getDefaultInterviewLocation(ctx: TenantRequestContext): Promise<string> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'address' } } });
    return (row?.value as string | undefined) ?? '';
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
      await this.sms.sendSms(ctx, applicant.phone, renderTemplate(template, { name: applicant.name }));
    }
    return updated;
  }

  /** رد نهایی توسط مدیر (تأیید نهایی از مسیر hireApplicant انجام می‌شود). */
  async managementDecision(ctx: TenantRequestContext, id: string, dto: DecisionDto, opts?: { fromApprovals?: boolean }) {
    this.assertManager(ctx);
    if (dto.approved) throw new BadRequestException('تأیید نهایی با ثبت جذب (تعیین واحد و شماره‌ی پرسنلی) انجام می‌شود');
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    if (applicant.stage !== 'AWAITING_MANAGEMENT' && applicant.stage !== 'MANAGEMENT_APPROVED') {
      throw new BadRequestException('این متقاضی در مرحله‌ی تأیید نهایی مدیر نیست');
    }
    const managementUserId = await resolveTenantUserId(ctx).catch(() => undefined);

    const updated = await ctx.tenantDb.jobApplicant.update({
      where: { id },
      data: {
        stage: 'MANAGEMENT_REJECTED',
        managementDecisionReason: dto.reason,
        managementDecisionAt: new Date(),
        managementUserId,
      },
      include: APPLICANT_INCLUDE,
    });
    if (!opts?.fromApprovals) await this.approvals.closeForEntity(ctx, 'JOB_APPLICANT', id, 'REJECTED');

    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled) {
      await this.sms.sendSms(ctx, applicant.phone, renderTemplate(settings.managementRejectedTemplate, { name: applicant.name }));
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
    const location = dto.location?.trim() || (await this.getDefaultInterviewLocation(ctx));

    const interview = await ctx.tenantDb.jobInterview.create({
      data: {
        applicantId: dto.applicantId,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes,
        interviewerUserId: dto.interviewerUserId,
        location: location || undefined,
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
        date: faDate(interview.scheduledAt),
        time: faTime(interview.scheduledAt),
        location: interview.location || 'دفتر شرکت',
      });
      await this.sms.sendSms(ctx, applicant.phone, message);
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

  private offerLink(ctx: TenantRequestContext, token: string): string {
    const base = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/offer/${ctx.tenantSlug}/${token}`;
  }

  private async sendOfferSms(ctx: TenantRequestContext, applicantName: string, phone: string, token: string): Promise<void> {
    const settings = await this.getSmsSettings(ctx);
    if (!settings.enabled || !settings.offerSentTemplate) return;
    await this.sms.sendSms(ctx, phone, renderTemplate(settings.offerSentTemplate, { name: applicantName, link: this.offerLink(ctx, token) }));
  }

  /**
   * ثبت شرایط همکاری توسط کارشناس — بعد از تأیید کارشناس. با ثبت، شرایط همان لحظه
   * برای متقاضی «ارسال‌شده» می‌شود و (در صورت فعال بودن پیامک) لینکش پیامک می‌شود.
   */
  async createOrUpdateOffer(ctx: TenantRequestContext, applicantId: string, dto: CreateOfferDto) {
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id: applicantId }, include: { offer: true } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    const allowedStages = ['SPECIALIST_APPROVED', 'OFFER_SENT', 'OFFER_DECLINED', 'MANAGEMENT_APPROVED'];
    if (!allowedStages.includes(applicant.stage)) {
      throw new BadRequestException('فقط برای متقاضی تأییدشده توسط کارشناس می‌توان شرایط همکاری تعیین کرد');
    }

    const data = {
      jobDescription: dto.jobDescription,
      collaborationType: dto.collaborationType,
      workingHours: dto.workingHours,
      salary: dto.salary,
      benefits: dto.benefits,
      durationMonths: dto.durationMonths,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      status: 'SENT' as const,
      candidateSignature: null,
      candidateAcceptedAt: null,
      candidateRejectedAt: null,
    };
    const offer = await ctx.tenantDb.jobOffer.upsert({
      where: { applicantId },
      create: { applicantId, ...data },
      update: data,
    });
    await ctx.tenantDb.jobApplicant.update({ where: { id: applicantId }, data: { stage: 'OFFER_SENT' } });
    await this.sendOfferSms(ctx, applicant.name, applicant.phone, offer.publicToken);
    return offer;
  }

  /** ارسال مجدد لینک شرایط همکاری برای متقاضی (پیامک). */
  async sendOffer(ctx: TenantRequestContext, offerId: string) {
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { id: offerId }, include: { applicant: true } });
    if (!offer) throw new NotFoundException('این شرایط همکاری یافت نشد');
    if (offer.status !== 'SENT') throw new BadRequestException('این شرایط همکاری در وضعیت ارسال نیست');
    await this.sendOfferSms(ctx, offer.applicant.name, offer.applicant.phone, offer.publicToken);
    return { ...offer, link: this.offerLink(ctx, offer.publicToken) };
  }

  async getOfferForApplicant(ctx: TenantRequestContext, applicantId: string) {
    const offer = await ctx.tenantDb.jobOffer.findUnique({ where: { applicantId } });
    if (!offer) throw new NotFoundException('برای این متقاضی شرایط همکاری‌ای ثبت نشده است');
    return { ...offer, link: this.offerLink(ctx, offer.publicToken) };
  }

  /** بعد از پذیرش و امضای متقاضی: مرحله به «منتظر تأیید مدیر» می‌رود و کارتابل/اعلان مدیر ساخته می‌شود. */
  async onOfferAccepted(ctx: TenantRequestContext, applicantId: string): Promise<void> {
    const applicant = await ctx.tenantDb.jobApplicant.update({
      where: { id: applicantId },
      data: { stage: 'AWAITING_MANAGEMENT' },
      include: { jobPosting: { select: { title: true } } },
    });
    await this.approvals.request(ctx, {
      moduleCode: RECRUITMENT_MODULE_CODE,
      entityType: 'JOB_APPLICANT',
      entityId: applicantId,
      title: `تأیید نهایی جذب ${applicant.name}`,
      summary: `متقاضی «${applicant.jobPosting.title}» شرایط همکاری را پذیرفته و امضا کرده است.`,
      link: '/recruitment',
      isOfficial: true,
    });
  }

  async onOfferDeclined(ctx: TenantRequestContext, applicantId: string): Promise<void> {
    await ctx.tenantDb.jobApplicant.update({ where: { id: applicantId }, data: { stage: 'OFFER_DECLINED' } });
  }

  /* ───────────────────────── جذب نهایی → HR ───────────────────────── */

  /** شماره‌ی پرسنلی بعدی: بزرگ‌ترین شماره‌ی صادرشده + ۱، با حفظ پیشوند و تعداد ارقام. */
  async nextEmployeeCode(ctx: TenantRequestContext): Promise<string> {
    const rows = await ctx.tenantDb.employee.findMany({ select: { employeeCode: true } });
    let best: { prefix: string; num: number; width: number } | null = null;
    for (const { employeeCode } of rows) {
      const m = /^(.*?)(\d+)$/.exec(employeeCode);
      if (!m) continue;
      const num = Number(m[2]);
      if (!best || num > best.num) best = { prefix: m[1], num, width: m[2].length };
    }
    if (!best) return '1001';
    return `${best.prefix}${String(best.num + 1).padStart(best.width, '0')}`;
  }

  async hireApplicant(ctx: TenantRequestContext, applicantId: string, dto: HireApplicantDto, opts?: { fromApprovals?: boolean }) {
    this.assertManager(ctx);
    const applicant = await ctx.tenantDb.jobApplicant.findUnique({ where: { id: applicantId }, include: { offer: true, jobPosting: true } });
    if (!applicant) throw new NotFoundException('این متقاضی یافت نشد');
    if (applicant.stage !== 'AWAITING_MANAGEMENT' && applicant.stage !== 'MANAGEMENT_APPROVED') {
      throw new BadRequestException('این متقاضی هنوز شرایط همکاری را تأیید و امضا نکرده است');
    }
    if (!applicant.offer || applicant.offer.status !== 'ACCEPTED') throw new BadRequestException('شرایط همکاری توسط متقاضی پذیرفته نشده است');

    const hiredCount = await ctx.tenantDb.jobApplicant.count({ where: { jobPostingId: applicant.jobPostingId, stage: 'HIRED' } });
    if (hiredCount >= applicant.jobPosting.capacity) {
      throw new BadRequestException(`ظرفیت جذب این آگهی (${applicant.jobPosting.capacity} نفر) تکمیل شده است`);
    }

    let departmentId: string | undefined;
    let departmentName = 'تعیین نشده';
    if (dto.departmentId) {
      const department = await ctx.tenantDb.department.findUnique({ where: { id: dto.departmentId } });
      if (!department) throw new BadRequestException('واحد انتخاب‌شده یافت نشد');
      departmentId = department.id;
      departmentName = department.name;
    }

    let employeeCode = dto.employeeCode?.trim() || (await this.nextEmployeeCode(ctx));
    if (dto.employeeCode?.trim()) {
      const clash = await ctx.tenantDb.employee.findUnique({ where: { employeeCode } });
      if (clash) throw new BadRequestException('این شماره‌ی پرسنلی قبلاً صادر شده است');
    } else {
      // دو تأیید هم‌زمان نباید یک شماره بگیرند
      while (await ctx.tenantDb.employee.findUnique({ where: { employeeCode } })) {
        const m = /^(.*?)(\d+)$/.exec(employeeCode)!;
        employeeCode = `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
      }
    }

    const employee = await ctx.tenantDb.employee.create({
      data: {
        employeeCode,
        fullName: applicant.name,
        phone: applicant.phone,
        position: applicant.jobPosting.title,
        departmentId,
        hireDate: applicant.offer.startDate ?? new Date(),
        baseSalary: applicant.offer.salary,
        status: 'ACTIVE',
      },
    });

    const managerUserId = await resolveTenantUserId(ctx).catch(() => undefined);
    await ctx.tenantDb.jobOffer.update({
      where: { id: applicant.offer.id },
      data: { stampApplied: !!dto.applyStamp, signedByUserId: managerUserId, signedAt: new Date() },
    });

    await ctx.tenantDb.employeeDocument.create({
      data: {
        employeeId: employee.id,
        type: 'CONTRACT',
        title: `قرارداد همکاری — ${applicant.name}`,
        fileUrl: `/recruitment/offers/${applicant.offer.id}/pdf`,
      },
    });

    let finalEmployee = employee;
    if (dto.createLogin && dto.roleId) {
      // inviteUser خودش پیامک «دسترسی فعال شد + نحوه‌ی ورود» را می‌فرستد.
      const user = await this.users.inviteUser(ctx, applicant.name, applicant.phone, dto.roleId);
      finalEmployee = await ctx.tenantDb.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
    }

    await ctx.tenantDb.jobApplicant.update({
      where: { id: applicantId },
      data: { stage: 'HIRED', managementDecisionAt: new Date(), managementUserId: managerUserId },
    });
    if (!opts?.fromApprovals) await this.approvals.closeForEntity(ctx, 'JOB_APPLICANT', applicantId, 'APPROVED', !!dto.applyStamp);

    const settings = await this.getSmsSettings(ctx);
    if (settings.enabled && settings.hiredTemplate) {
      await this.sms.sendSms(ctx, 
        applicant.phone,
        renderTemplate(settings.hiredTemplate, { name: applicant.name, employeeCode, department: departmentName }),
      );
    }
    await this.automation.emit(ctx, 'recruitment.applicant.hired', { applicantName: applicant.name, jobTitle: applicant.jobPosting.title });

    return finalEmployee;
  }
}
