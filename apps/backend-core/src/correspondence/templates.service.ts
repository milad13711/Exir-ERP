import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CorrLetterType, CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto.js';
import { htmlSizeWithoutImages, sanitizeLetterHtml } from './pdf/sanitize-letter-html.js';
import { DEFAULT_TEMPLATES } from './templates.defaults.js';
import { applyTemplate, TEMPLATE_PLACEHOLDERS, unknownPlaceholders, type TemplateContext, type TemplatePlaceholder } from './templates.apply.js';

const SEED_KEY = { moduleCode: 'correspondence', key: 'defaultTemplatesSeeded' } as const;

/** مقدارهای نمونه برای پیش‌نمایش قالب. */
export const SAMPLE_CONTEXT: Record<TemplatePlaceholder, string> = {
  recipientName: 'آقای دکتر محمدی', recipientTitle: 'مدیرعامل محترم', subject: 'موضوع نمونه', date: '۱۴۰۵/۰۷/۲۹', number: '۱۴۰۵/۱۲۳۴',
  senderName: 'علی رضایی', senderTitle: 'مدیر دبیرخانه', orgName: 'شرکت نمونه', attachments: '۲ برگ', departmentName: 'واحد نمونه',
};

export function cleanContext(raw: Record<string, unknown> | undefined): TemplateContext {
  const out: TemplateContext = {};
  if (!raw) return out;
  for (const k of TEMPLATE_PLACEHOLDERS) {
    const v = raw[k];
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (v === null) out[k] = null;
  }
  return out;
}

@Injectable()
export class TemplatesService {
  /** idempotent: قالب‌های پیش‌فرض فقط یک‌بار (نشانگر در module_settings؛ مسابقه‌ی هم‌زمان با unique جلوگیری می‌شود). */
  async ensureDefaultTemplates(ctx: TenantRequestContext): Promise<void> {
    const marker = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SEED_KEY } });
    if (marker) return;
    try {
      await ctx.tenantDb.moduleSetting.create({ data: { ...SEED_KEY, value: true } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return; // درخواست هم‌زمان دیگر seed می‌کند
      throw e;
    }
    if ((await ctx.tenantDb.corrTemplate.count()) > 0) return; // مستأجر پیش‌تر قالب ساخته؛ دست نمی‌زنیم
    await ctx.tenantDb.corrTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ ...t, bodyHtml: sanitizeLetterHtml(t.bodyHtml), isSystem: true })),
    });
  }

  async list(ctx: TenantRequestContext, opts: { letterType?: string; activeOnly?: boolean } = {}) {
    await this.ensureDefaultTemplates(ctx);
    const where: Record<string, unknown> = {};
    if (opts.activeOnly) where.isActive = true;
    if (opts.letterType && opts.letterType !== 'ALL') where.letterType = opts.letterType === 'ANY' ? 'ANY' : { in: [opts.letterType, 'ANY'] };
    return ctx.tenantDb.corrTemplate.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async get(ctx: TenantRequestContext, id: string) {
    const t = await ctx.tenantDb.corrTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('قالب یافت نشد');
    return t;
  }

  private cleanBody(html: string): string {
    const clean = sanitizeLetterHtml(html);
    if (htmlSizeWithoutImages(clean) > 500 * 1024) throw new BadRequestException('متن قالب بیش از حد بزرگ است');
    const bad = unknownPlaceholders(clean);
    if (bad.length) throw new BadRequestException(`جانشین ناشناخته در قالب: ${bad.map((b) => `{{${b}}}`).join('، ')} (مجاز: ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join('، ')})`);
    return clean;
  }

  private cleanSubject(subject: string): string {
    const bad = unknownPlaceholders(subject);
    if (bad.length) throw new BadRequestException(`جانشین ناشناخته در موضوع: ${bad.map((b) => `{{${b}}}`).join('، ')}`);
    return subject.trim();
  }

  async create(ctx: TenantRequestContext, dto: CreateTemplateDto) {
    return ctx.tenantDb.corrTemplate.create({
      data: {
        name: dto.name.trim(), letterType: dto.letterType ?? 'ANY', categoryId: dto.categoryId || null, subject: this.cleanSubject(dto.subject ?? ''),
        bodyHtml: this.cleanBody(dto.bodyHtml), defaultLetterheadId: dto.defaultLetterheadId || null, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0,
        createdBy: await resolveTenantUserId(ctx),
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateTemplateDto) {
    await this.get(ctx, id);
    return ctx.tenantDb.corrTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.letterType !== undefined ? { letterType: dto.letterType } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.subject !== undefined ? { subject: this.cleanSubject(dto.subject) } : {}),
        ...(dto.bodyHtml !== undefined ? { bodyHtml: this.cleanBody(dto.bodyHtml) } : {}),
        ...(dto.defaultLetterheadId !== undefined ? { defaultLetterheadId: dto.defaultLetterheadId || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.get(ctx, id);
    await ctx.tenantDb.corrTemplate.delete({ where: { id } });
    return { success: true };
  }

  /** رندر قالب با مقدارهای داده‌شده؛ مقدارهای ندادن‌شده با نمونه پر می‌شوند فقط اگر useSample. */
  async renderPreview(ctx: TenantRequestContext, id: string, context?: Record<string, unknown>, useSample = true) {
    const t = await this.get(ctx, id);
    const merged: TemplateContext = { ...(useSample ? SAMPLE_CONTEXT : {}), ...cleanContext(context) };
    return { ...applyTemplate(t, merged), letterType: t.letterType as CorrLetterType, defaultLetterheadId: t.defaultLetterheadId };
  }
}
