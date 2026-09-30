import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { faDate, faTime } from '../common/persian.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import { CrmOpportunityService } from '../crm/crm-opportunity.service.js';
import type { CreateSessionDto } from './dto/create-session.dto.js';
import type { UpdateSessionDto } from './dto/update-session.dto.js';
import type { CreateSessionInvoiceDto } from './dto/create-session-invoice.dto.js';
import type { CreateOpportunityDto } from './dto/create-opportunity.dto.js';
import { publicRef } from '../common/tenant-public-key.js';

export function formatWhenFa(date: Date): string {
  const d = faDate(date);
  const t = faTime(date);
  return `${d} ساعت ${t}`;
}

const MODE_LABEL_FA: Record<string, string> = { ONLINE: 'آنلاین', PHONE: 'تلفنی', IN_PERSON: 'حضوری' };

const SESSION_INCLUDE = {
  engagement: { include: { contact: { select: { id: true, name: true, phone: true } }, advisor: { select: { id: true, name: true, phone: true } } } },
  survey: { select: { rating: true, note: true, sentAt: true, submittedAt: true } },
} as const;

const MENTORING_MODULE_CODE = 'mentoring';
const SMS_KEY = { moduleCode: MENTORING_MODULE_CODE, key: 'sms' } as const;

export type MentoringSmsSettings = {
  enabled: boolean;
  scheduledContactTemplate: string;
  scheduledAdvisorTemplate: string;
  reminderContactTemplate: string;
  reminderAdvisorTemplate: string;
  surveyTemplate: string;
};
export const DEFAULT_MENTORING_SMS: MentoringSmsSettings = {
  enabled: true,
  scheduledContactTemplate: 'جلسه‌ی «{title}» شما در تاریخ {when} به‌صورت {mode} ثبت شد.{addressPart}',
  scheduledAdvisorTemplate: 'جلسه‌ی جدید با {contactName} در تاریخ {when} ({mode}) برایتان ثبت شد.',
  reminderContactTemplate: 'یادآوری: جلسه‌ی «{title}» شما ساعتی دیگر، در {when} برگزار می‌شود.',
  reminderAdvisorTemplate: 'یادآوری: جلسه‌ی شما با {contactName} در {when} برگزار می‌شود.',
  surveyTemplate: 'جلسه‌ی «{title}» به پایان رسید. نظر شما به بهبود کیفیت جلسات کمک می‌کند: {link}',
};

export function renderMentoringTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, val] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, val);
  return out;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly sms: TenantSmsService,
    private readonly invoices: InvoicesService,
    private readonly crmOpportunity: CrmOpportunityService,
  ) {}

  async getSmsSettings(ctx: TenantRequestContext): Promise<MentoringSmsSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SMS_KEY } });
    return row ? { ...DEFAULT_MENTORING_SMS, ...(row.value as Partial<MentoringSmsSettings>) } : DEFAULT_MENTORING_SMS;
  }

  async setSmsSettings(ctx: TenantRequestContext, dto: MentoringSmsSettings): Promise<MentoringSmsSettings> {
    const value = { ...dto };
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SMS_KEY }, update: { value }, create: { ...SMS_KEY, value } });
    return this.getSmsSettings(ctx);
  }

  list(ctx: TenantRequestContext, filters: { engagementId?: string; contactId?: string; status?: string; from?: Date; to?: Date }) {
    return ctx.tenantDb.mentoringSession.findMany({
      where: {
        ...(filters.engagementId ? { engagementId: filters.engagementId } : {}),
        ...(filters.contactId ? { engagement: { contactId: filters.contactId } } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.from || filters.to
          ? { scheduledAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
          : {}),
      },
      include: SESSION_INCLUDE,
      orderBy: { scheduledAt: 'desc' },
    });
  }

  upcomingThisWeek(ctx: TenantRequestContext) {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 86_400_000);
    return ctx.tenantDb.mentoringSession.findMany({
      where: { scheduledAt: { gte: from, lte: to }, status: 'SCHEDULED' },
      include: SESSION_INCLUDE,
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id }, include: SESSION_INCLUDE });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    return session;
  }

  async create(ctx: TenantRequestContext, dto: CreateSessionDto) {
    const engagement = await ctx.tenantDb.mentoringEngagement.findUnique({
      where: { id: dto.engagementId },
      include: { contact: true, advisor: true },
    });
    if (!engagement) throw new NotFoundException('همکاری مورد نظر یافت نشد');
    if (engagement.status !== 'ACTIVE') throw new ConflictException('فقط برای همکاری فعال می‌توان جلسه ثبت کرد');

    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('زمان جلسه نامعتبر است');
    const mode = dto.mode ?? 'ONLINE';
    if (mode === 'IN_PERSON' && !dto.location) throw new BadRequestException('برای جلسه‌ی حضوری، آدرس الزامی است');

    const createdByUserId = await resolveTenantUserId(ctx);
    const session = await ctx.tenantDb.mentoringSession.create({
      data: {
        engagementId: dto.engagementId,
        appointmentId: dto.appointmentId,
        mode,
        scheduledAt,
        durationMinutes: dto.durationMinutes ?? 60,
        location: dto.location,
        createdByUserId,
      },
      include: SESSION_INCLUDE,
    });

    await this.automation.emit(ctx, 'mentoring.session.scheduled', {
      engagementTitle: engagement.title,
      contactName: engagement.contact.name,
      advisorName: engagement.advisor.name,
      scheduledAt: scheduledAt.toISOString(),
      mode,
    });

    const whenFa = formatWhenFa(scheduledAt);
    const modeLabel = MODE_LABEL_FA[mode];
    const smsSettings = await this.getSmsSettings(ctx);
    if (smsSettings.enabled) {
      if (engagement.contact.phone) {
        const addressPart = mode === 'IN_PERSON' && dto.location ? ` — آدرس: ${dto.location}` : '';
        await this.sms.sendSms(
          ctx,
          engagement.contact.phone,
          renderMentoringTemplate(smsSettings.scheduledContactTemplate, { title: engagement.title, when: whenFa, mode: modeLabel, addressPart }),
        );
      }
      if (engagement.advisor.phone) {
        await this.sms.sendSms(
          ctx,
          engagement.advisor.phone,
          renderMentoringTemplate(smsSettings.scheduledAdvisorTemplate, { contactName: engagement.contact.name, when: whenFa, mode: modeLabel }),
        );
      }
    }

    return session;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateSessionDto) {
    const existing = await ctx.tenantDb.mentoringSession.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این جلسه یافت نشد');
    if (existing.status !== 'SCHEDULED') throw new ConflictException('فقط جلسه‌ی زمان‌بندی‌شده قابل ویرایش است');

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('زمان جلسه نامعتبر است');

    return ctx.tenantDb.mentoringSession.update({
      where: { id },
      data: {
        mode: dto.mode,
        scheduledAt,
        durationMinutes: dto.durationMinutes,
        location: dto.location,
        // زمان‌بندی دوباره شد — یادآور قبلی دیگر معتبر نیست، دوباره ارسال می‌شود
        reminderSentAt: scheduledAt ? null : undefined,
      },
      include: SESSION_INCLUDE,
    });
  }

  /** پس از تکمیل جلسه: صورت‌جلسه ثبت می‌شود و لینک نظرسنجی برای مشتری پیامک می‌شود. */
  async complete(ctx: TenantRequestContext, id: string, minutesNote: string | undefined, publicWebUrl: string, tenantSlug: string) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({
      where: { id },
      include: { engagement: { include: { contact: true } } },
    });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    if (session.status !== 'SCHEDULED') throw new ConflictException('فقط جلسه‌ی زمان‌بندی‌شده قابل تکمیل است');

    await ctx.tenantDb.mentoringSession.update({
      where: { id },
      data: { status: 'COMPLETED', minutesNote },
    });

    const survey = await ctx.tenantDb.mentoringSessionSurvey.create({ data: { sessionId: id } });
    const smsSettings = await this.getSmsSettings(ctx);
    if (smsSettings.enabled && session.engagement.contact.phone && publicWebUrl) {
      const url = `${publicWebUrl}/mentoring-survey/${publicRef(tenantSlug)}/${survey.publicToken}`;
      const result = await this.sms.sendSms(
        ctx,
        session.engagement.contact.phone,
        renderMentoringTemplate(smsSettings.surveyTemplate, { title: session.engagement.title, link: url }),
      );
      if (result.success) {
        await ctx.tenantDb.mentoringSessionSurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
        await ctx.tenantDb.mentoringSession.update({ where: { id }, data: { surveySentAt: new Date() } });
      }
    }

    await this.automation.emit(ctx, 'mentoring.session.completed', {
      engagementTitle: session.engagement.title,
      contactName: session.engagement.contact.name,
      scheduledAt: session.scheduledAt.toISOString(),
    });

    return this.detail(ctx, id);
  }

  async cancel(ctx: TenantRequestContext, id: string, reason: string | undefined) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    if (session.status !== 'SCHEDULED') throw new ConflictException('فقط جلسه‌ی زمان‌بندی‌شده قابل لغو است');
    return ctx.tenantDb.mentoringSession.update({
      where: { id },
      data: { status: 'CANCELLED', minutesNote: reason },
      include: SESSION_INCLUDE,
    });
  }

  async noShow(ctx: TenantRequestContext, id: string) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    if (session.status !== 'SCHEDULED') throw new ConflictException('فقط جلسه‌ی زمان‌بندی‌شده قابل ثبت به‌عنوان عدم‌حضور است');
    return ctx.tenantDb.mentoringSession.update({ where: { id }, data: { status: 'NO_SHOW' }, include: SESSION_INCLUDE });
  }

  /** مبلغ پیشنهادی فاکتور بر اساس مدل تعرفه‌ی همکاری — فرانت این را به‌عنوان پیش‌فرض نشان می‌دهد، مبلغ نهایی دستی تأیید می‌شود. */
  async suggestedAmount(ctx: TenantRequestContext, id: string): Promise<number | null> {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id }, include: { engagement: true } });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    const e = session.engagement;
    if (e.pricingModel === 'HOURLY' && e.hourlyRate != null) {
      return Math.round((e.hourlyRate * session.durationMinutes) / 60);
    }
    if (e.pricingModel === 'PACKAGE' && e.packagePrice != null && e.packageSessionsCount) {
      return Math.round(e.packagePrice / e.packageSessionsCount);
    }
    if (e.pricingModel === 'SUBSCRIPTION' && e.subscriptionMonthlyPrice != null) {
      return e.subscriptionMonthlyPrice;
    }
    return null;
  }

  /** فاکتور فروش را از طریق سرویس مرکزی فروش صادر می‌کند تا از موتور حسابداری/مالیات مشترک استفاده شود، نه ثبت مستقیم. */
  async createInvoice(ctx: TenantRequestContext, id: string, dto: CreateSessionInvoiceDto) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id }, include: { engagement: true } });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    if (session.invoiceId) throw new ConflictException('برای این جلسه قبلاً فاکتور صادر شده است');

    const invoice = await this.invoices.create(ctx, {
      contactId: session.engagement.contactId,
      projectId: session.engagement.projectId ?? undefined,
      notes: `جلسه‌ی مشاوره در تاریخ ${formatWhenFa(session.scheduledAt)}`,
      lines: [{ description: `جلسه‌ی مشاوره — ${session.engagement.title}`, quantity: 1, unitPrice: dto.amount }],
    });

    await ctx.tenantDb.mentoringSession.update({ where: { id }, data: { invoiceId: invoice.id } });
    return invoice;
  }

  /**
   * ساخت فرصت فروش در CRM برای پیگیریِ بعد از جلسه — فقط برای جلسه‌ی تکمیل‌شده، تا خلاصه‌ای که
   * پرسنل از گفتگو می‌نویسد معنا داشته باشد. به مخاطبِ همان همکاری (engagement) وصل می‌شود.
   */
  async createOpportunity(ctx: TenantRequestContext, id: string, dto: CreateOpportunityDto) {
    const session = await ctx.tenantDb.mentoringSession.findUnique({ where: { id }, include: { engagement: true } });
    if (!session) throw new NotFoundException('این جلسه یافت نشد');
    if (session.status !== 'COMPLETED') {
      throw new ConflictException('فقط برای جلسه‌ی تکمیل‌شده می‌توان فرصت فروش ساخت');
    }

    const ownerUserId = await resolveTenantUserId(ctx).catch(() => null);
    return this.crmOpportunity.create(ctx, {
      contactId: session.engagement.contactId,
      title: dto.title,
      value: dto.value,
      stage: dto.stage,
      expectedCloseAt: dto.expectedCloseAt,
      summary: dto.summary,
      ownerUserId,
    });
  }
}
