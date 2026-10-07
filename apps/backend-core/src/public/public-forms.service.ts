import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import QRCode from 'qrcode';
import { publicRef } from '../common/tenant-public-key.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { validateSubmission, maskIp } from '../forms/form-submission-validation.js';
import { decideCors, type CorsDecision } from '../forms/embed-origins.js';
import { verifyCaptcha } from '../forms/captcha.js';

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
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
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

  /**
   * اسکیمای عمومی و نسخه‌دار (v1) برای توسعه‌دهنده‌ها — فقط آنچه برای ساخت/ارسال فرم لازم است.
   * هرگز شامل شناسه‌ی داخلی فرم، سازنده، یادداشت‌ها، پاسخ صحیح آزمون یا امتیاز سؤال‌ها نیست.
   */
  async getSchema(slug: string, formSlug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({
      where: { slug: formSlug },
      include: { fields: { orderBy: { sortOrder: 'asc' }, select: { id: true, type: true, label: true, helpText: true, required: true, options: true } } },
    });
    if (!form || form.status !== 'PUBLISHED') throw new NotFoundException('این فرم یافت نشد');
    const isClosed = form.closesAt != null && new Date() > form.closesAt;
    return {
      version: 1,
      form: { slug: form.slug, type: form.type, title: form.title, description: form.description, isClosed, closesAt: form.closesAt },
      respondent: { collectPhone: form.collectPhone, requirePhone: form.requirePhone },
      fields: form.fields.map((f) => ({
        name: f.id, // کلید ارسال در answers
        type: f.type,
        label: f.label,
        helpText: f.helpText,
        required: f.required,
        options: f.type === 'SINGLE_CHOICE' || f.type === 'MULTI_CHOICE' ? f.options : undefined,
      })),
      submit: { method: 'POST', path: `/api/public/forms/${publicRef(slug)}/${formSlug}/submit`, contentTypes: ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'], honeypotField: '_hp' },
    };
  }

  /** تصمیم CORS برای یک فرم — درخواست بدون Origin (سرور به سرور) همیشه مجاز است. */
  async corsFor(slug: string, formSlug: string, origin: string | undefined): Promise<CorsDecision> {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({ where: { slug: formSlug }, select: { allowedOrigins: true } });
    if (!form) return { allowed: true, allowOrigin: '*', vary: false }; // وجود/عدم وجود فرم را لو نمی‌دهیم؛ خودِ درخواست ۴۰۴ می‌شود
    return decideCors(form.allowedOrigins, origin);
  }

  /**
   * QR لینک مستقیم فرم (برای بیو اینستاگرام، واتس‌اپ، چاپ). فقط آدرس همین فرم را رمزگذاری می‌کند —
   * پایه‌ی آدرس فقط از WEB_PANEL_PUBLIC_URL یا یکی از CORS_ORIGINS مورد اعتماد می‌آید، نه ورودی دلخواه.
   */
  async getQrPng(slug: string, formSlug: string, baseCandidate: string | undefined, fallbackBase: string): Promise<Buffer> {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({ where: { slug: formSlug }, select: { status: true } });
    if (!form || form.status !== 'PUBLISHED') throw new NotFoundException('این فرم یافت نشد');
    const trusted = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
    const envBase = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    const cand = baseCandidate?.replace(/\/$/, '');
    const base = cand && trusted.includes(cand) ? cand : envBase || fallbackBase;
    return QRCode.toBuffer(`${base}/f/${publicRef(slug)}/${formSlug}`, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 480 });
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

  async submit(slug: string, formSlug: string, rawBody: unknown, req: { ip?: string | null; origin?: string; referer?: string } = {}) {
    const ctx = await this.resolveTenantCtx(slug);
    const form = await ctx.tenantDb.form.findUnique({ where: { slug: formSlug }, include: { fields: true } });
    if (!form || form.status !== 'PUBLISHED') throw new NotFoundException('این فرم یافت نشد');
    if (form.closesAt && new Date() > form.closesAt) throw new BadRequestException('مهلت ثبت این فرم به پایان رسیده است');

    const input = validateSubmission(form, rawBody);

    // ربات‌ها فیلد مخفی را پر می‌کنند — موفقیتِ ساختگی برمی‌گردد و چیزی ذخیره نمی‌شود
    if (input.honeypotTripped) return { submissionId: null, scorePercent: null, passed: null, thankYouMessage: form.thankYouMessage };

    await verifyCaptcha(input.captchaToken, req.ip ?? null);

    const fieldsById = new Map(form.fields.map((f) => [f.id, f]));

    let scorePercent: number | null = null;
    let passed: boolean | null = null;
    if (form.type === 'QUIZ') {
      const scorable = form.fields.filter((f) => f.type === 'SINGLE_CHOICE' && f.points);
      const totalPoints = scorable.reduce((sum, f) => sum + (f.points ?? 0), 0);
      let earned = 0;
      for (const field of scorable) {
        const answer = input.answers.find((a) => a.fieldId === field.id);
        if (answer?.valueText && answer.valueText === field.correctOption) earned += field.points ?? 0;
      }
      scorePercent = totalPoints > 0 ? Math.round((earned / totalPoints) * 100) : 0;
      passed = form.passScorePercent != null ? scorePercent >= form.passScorePercent : null;
    }

    let contactId: string | undefined;
    if (form.createContact && form.collectPhone && input.respondentPhone) {
      const contact = await this.resolveOrCreateContact(ctx, input.respondentName ?? '', input.respondentPhone);
      contactId = contact.id;
    }

    const sourceUrl = input.source.url ?? (req.referer && /^https?:\/\//i.test(req.referer) ? req.referer.slice(0, 500) : null);
    const hasMeta = Object.keys(input.source.utm).length > 0 || input.source.referrer || req.origin;
    const submission = await ctx.tenantDb.formSubmission.create({
      data: {
        formId: form.id,
        contactId,
        respondentName: input.respondentName,
        respondentPhone: input.respondentPhone,
        scorePercent,
        passed,
        sourceUrl,
        sourceMeta: hasMeta ? { utm: input.source.utm, referrer: input.source.referrer, origin: req.origin?.slice(0, 200) ?? null } : undefined,
        ipMasked: maskIp(req.ip),
        answers: {
          create: input.answers.filter((a) => fieldsById.has(a.fieldId)).map((a) => ({ fieldId: a.fieldId, valueText: a.valueText, valueOptions: a.valueOptions })),
        },
      },
    });

    // اعلان به سازنده‌ی فرم + اتوماسیون + وب‌هوک؛ هیچ‌کدام نباید ثبت پاسخ را خراب کنند
    const who = input.respondentName || input.respondentPhone || 'ناشناس';
    const safely = (p: Promise<unknown>) => p.catch(() => undefined);
    await Promise.all([
      form.createdByUserId
        ? safely(this.notifications.notify(ctx.tenantDb, { userId: form.createdByUserId, type: 'form_submission', title: `پاسخ جدید برای «${form.title}»`, body: who, link: `/forms?formId=${form.id}&submissionId=${submission.id}` }))
        : Promise.resolve(),
      safely(this.automation.emit(ctx, 'forms.submission.received', { formTitle: form.title, respondentName: input.respondentName ?? '', respondentPhone: input.respondentPhone ?? '' })),
      safely(this.webhooks.dispatch(ctx.tenantId, 'forms.submission.created', { formSlug: form.slug, formTitle: form.title, submissionId: submission.id, respondentName: input.respondentName, respondentPhone: input.respondentPhone, answers: input.answers.map((a) => ({ field: fieldsById.get(a.fieldId)?.label ?? '', value: a.valueOptions.length ? a.valueOptions : a.valueText })), submittedAt: submission.submittedAt.toISOString() })),
    ]);

    return { submissionId: submission.id, scorePercent, passed, thankYouMessage: form.thankYouMessage };
  }
}
