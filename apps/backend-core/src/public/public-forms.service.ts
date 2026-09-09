import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { SubmitPublicFormDto } from './dto/submit-public-form.dto.js';

/**
 * بدون ورود و بدون OTP — یک فرم عمومی (نظرسنجی/آزمون/پرسش‌نامه/ثبت‌نام) صرفاً
 * داده جمع می‌کند، مثل فلوی سفارش فروشگاه آنلاین، نه مثل خرید بلیط/نوبت که
 * پول یا ظرفیت واقعی درگیر است — پس اصطکاک OTP اینجا توجیهی ندارد.
 */
@Injectable()
export class PublicFormsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const formsModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'forms' } },
    });
    if (!formsModule) throw new NotFoundException('این فرم در دسترس نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async getForm(slug: string, formSlug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({
      where: { slug: formSlug },
      include: { fields: { orderBy: { sortOrder: 'asc' }, select: { id: true, type: true, label: true, helpText: true, required: true, sortOrder: true, options: true } } },
    });
    if (!form || form.status !== 'PUBLISHED') throw new NotFoundException('این فرم یافت نشد');

    const isClosed = form.closesAt != null && new Date() > form.closesAt;
    return {
      id: form.id,
      type: form.type,
      title: form.title,
      description: form.description,
      coverImage: form.coverImage,
      collectPhone: form.collectPhone,
      requirePhone: form.requirePhone,
      fields: form.fields,
      isClosed,
    };
  }

  async getCoverImage(slug: string, formSlug: string): Promise<string | null> {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({ where: { slug: formSlug }, select: { coverImage: true, status: true } });
    if (!form || form.status !== 'PUBLISHED') return null;
    return form.coverImage;
  }

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name: name || phone, phone, isCustomer: true, source: 'فرم آنلاین' } });
  }

  async submit(slug: string, formSlug: string, dto: SubmitPublicFormDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({ where: { slug: formSlug }, include: { fields: true } });
    if (!form || form.status !== 'PUBLISHED') throw new NotFoundException('این فرم یافت نشد');
    if (form.closesAt && new Date() > form.closesAt) throw new BadRequestException('مهلت ثبت این فرم به پایان رسیده است');
    if (form.requirePhone && !dto.respondentPhone?.trim()) throw new BadRequestException('شماره موبایل الزامی است');

    const fieldsById = new Map(form.fields.map((f) => [f.id, f]));
    for (const field of form.fields) {
      if (!field.required) continue;
      const answer = dto.answers.find((a) => a.fieldId === field.id);
      const hasValue = answer && (answer.valueText?.trim() || (answer.valueOptions && answer.valueOptions.length > 0));
      if (!hasValue) throw new BadRequestException(`پاسخ به «${field.label}» الزامی است`);
    }

    let scorePercent: number | null = null;
    let passed: boolean | null = null;
    if (form.type === 'QUIZ') {
      const scorable = form.fields.filter((f) => f.type === 'SINGLE_CHOICE' && f.points);
      const totalPoints = scorable.reduce((sum, f) => sum + (f.points ?? 0), 0);
      let earned = 0;
      for (const field of scorable) {
        const answer = dto.answers.find((a) => a.fieldId === field.id);
        if (answer?.valueText && answer.valueText === field.correctOption) earned += field.points ?? 0;
      }
      scorePercent = totalPoints > 0 ? Math.round((earned / totalPoints) * 100) : 0;
      passed = form.passScorePercent != null ? scorePercent >= form.passScorePercent : null;
    }

    let contactId: string | undefined;
    if (form.createContact && form.collectPhone && dto.respondentPhone?.trim()) {
      const contact = await this.resolveOrCreateContact(ctx, dto.respondentName?.trim() ?? '', dto.respondentPhone.trim());
      contactId = contact.id;
    }

    const submission = await ctx.tenantDb.formSubmission.create({
      data: {
        formId: form.id,
        contactId,
        respondentName: dto.respondentName?.trim(),
        respondentPhone: dto.respondentPhone?.trim(),
        scorePercent,
        passed,
        answers: {
          create: dto.answers
            .filter((a) => fieldsById.has(a.fieldId))
            .map((a) => ({ fieldId: a.fieldId, valueText: a.valueText, valueOptions: a.valueOptions ?? [] })),
        },
      },
    });

    await this.automation.emit(ctx, 'forms.submission.received', {
      formTitle: form.title,
      respondentName: dto.respondentName ?? '',
      respondentPhone: dto.respondentPhone ?? '',
    });

    return { submissionId: submission.id, scorePercent, passed, thankYouMessage: form.thankYouMessage };
  }
}
