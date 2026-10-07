import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateFormDto } from './dto/create-form.dto.js';
import type { UpdateFormDto } from './dto/update-form.dto.js';
import type { FormFieldDto } from './dto/form-field.dto.js';
import { normalizeOrigins } from './embed-origins.js';

const FORM_INCLUDE = {
  fields: { orderBy: { sortOrder: 'asc' as const } },
  createdBy: { select: { id: true, name: true } },
};

@Injectable()
export class FormsService {
  async list(ctx: TenantRequestContext, filters: { status?: string; type?: string } = {}, scope: Record<string, unknown> = {}) {
    const forms = await ctx.tenantDb.form.findMany({
      where: {
        ...scope,
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.type ? { type: filters.type as never } : {}),
      },
      include: { ...FORM_INCLUDE, _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const grouped = await ctx.tenantDb.formSubmission.groupBy({ by: ['formId'], where: { formId: { in: forms.map((f) => f.id) }, status: 'NEW' }, _count: { _all: true } });
    const newCounts = new Map(grouped.map((g) => [g.formId, g._count._all]));
    return forms.map((f) => ({ ...f, newCount: newCounts.get(f.id) ?? 0 }));
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    const form = await ctx.tenantDb.form.findFirst({ where: { id, ...scope }, include: { ...FORM_INCLUDE, _count: { select: { submissions: true } } } });
    if (!form) throw new NotFoundException('این فرم یافت نشد');
    return form;
  }

  private assertQuizFields(type: string, fields: FormFieldDto[]) {
    if (type !== 'QUIZ') return;
    const scorable = fields.filter((f) => f.type === 'SINGLE_CHOICE' && f.points);
    if (scorable.length === 0) throw new BadRequestException('برای آزمون آنلاین، حداقل یک سؤال تک‌گزینه‌ای با امتیاز لازم است');
  }

  async create(ctx: TenantRequestContext, dto: CreateFormDto) {
    const existingSlug = await ctx.tenantDb.form.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new BadRequestException('این شناسه‌ی عمومی قبلاً استفاده شده است');
    this.assertQuizFields(dto.type, dto.fields);

    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.form.create({
      data: {
        slug: dto.slug,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        coverImage: dto.coverImage,
        collectPhone: dto.collectPhone ?? true,
        requirePhone: dto.requirePhone ?? false,
        createContact: dto.createContact ?? dto.type === 'REGISTRATION',
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
        passScorePercent: dto.passScorePercent,
        thankYouMessage: dto.thankYouMessage,
        createdByUserId,
        fields: {
          create: dto.fields.map((f, i) => ({
            type: f.type,
            label: f.label,
            helpText: f.helpText,
            required: f.required ?? false,
            sortOrder: f.sortOrder ?? i,
            options: f.options ?? [],
            correctOption: f.correctOption,
            points: f.points,
          })),
        },
      },
      include: FORM_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateFormDto) {
    const existing = await ctx.tenantDb.form.findUnique({ where: { id }, include: { fields: true } });
    if (!existing) throw new NotFoundException('این فرم یافت نشد');
    if (dto.fields) this.assertQuizFields(existing.type, dto.fields);

    if (dto.fields) {
      // به‌جای حذف/ساخت همه‌ی فیلدها، فقط فیلدهایی که واقعاً حذف شده‌اند
      // پاک می‌شوند — تا پاسخ‌های ثبت‌شده‌ی فیلدهای دست‌نخورده باقی بمانند.
      const keepIds = new Set(dto.fields.filter((f) => f.id).map((f) => f.id!));
      const toDelete = existing.fields.filter((f) => !keepIds.has(f.id));
      await ctx.tenantDb.$transaction([
        ...(toDelete.length > 0 ? [ctx.tenantDb.formField.deleteMany({ where: { id: { in: toDelete.map((f) => f.id) } } })] : []),
        ...dto.fields.map((f, i) =>
          f.id
            ? ctx.tenantDb.formField.update({
                where: { id: f.id },
                data: {
                  type: f.type,
                  label: f.label,
                  helpText: f.helpText,
                  required: f.required ?? false,
                  sortOrder: f.sortOrder ?? i,
                  options: f.options ?? [],
                  correctOption: f.correctOption,
                  points: f.points,
                },
              })
            : ctx.tenantDb.formField.create({
                data: {
                  formId: id,
                  type: f.type,
                  label: f.label,
                  helpText: f.helpText,
                  required: f.required ?? false,
                  sortOrder: f.sortOrder ?? i,
                  options: f.options ?? [],
                  correctOption: f.correctOption,
                  points: f.points,
                },
              }),
        ),
      ]);
    }

    return ctx.tenantDb.form.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        coverImage: dto.coverImage,
        collectPhone: dto.collectPhone,
        requirePhone: dto.requirePhone,
        createContact: dto.createContact,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
        passScorePercent: dto.passScorePercent,
        thankYouMessage: dto.thankYouMessage,
        allowedOrigins: dto.allowedOrigins ? normalizeOrigins(dto.allowedOrigins) : undefined,
      },
      include: FORM_INCLUDE,
    });
  }

  async setStatus(ctx: TenantRequestContext, id: string, status: 'PUBLISHED' | 'CLOSED' | 'DRAFT') {
    const existing = await ctx.tenantDb.form.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این فرم یافت نشد');
    return ctx.tenantDb.form.update({ where: { id }, data: { status }, include: FORM_INCLUDE });
  }

  async delete(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.form.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این فرم یافت نشد');
    await ctx.tenantDb.form.delete({ where: { id } });
    return { ok: true };
  }

  /** برای نمایش تاریخچه‌ی پاسخ‌های یک مخاطب در پروفایل CRM — همه‌ی فرم‌ها، نه فقط یکی. */
  listSubmissionsByContact(ctx: TenantRequestContext, contactId: string, scope: Record<string, unknown> = {}) {
    return ctx.tenantDb.formSubmission.findMany({
      where: { contactId, form: { ...scope } },
      include: { form: { select: { id: true, title: true, slug: true, type: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /** خلاصه‌ی آمار — تعداد پاسخ، میانگین امتیاز رتبه‌ای (survey)، توزیع نمره و نرخ قبولی (quiz). */
  async stats(ctx: TenantRequestContext, formId: string, scope: Record<string, unknown> = {}) {
    const form = await ctx.tenantDb.form.findFirst({ where: { id: formId, ...scope }, include: { fields: true } });
    if (!form) throw new NotFoundException('این فرم یافت نشد');
    const submissions = await ctx.tenantDb.formSubmission.findMany({
      where: { formId },
      include: { answers: true },
    });

    const totalSubmissions = submissions.length;
    let quizStats: { avgScorePercent: number; passRate: number } | null = null;
    if (form.type === 'QUIZ' && totalSubmissions > 0) {
      const scored = submissions.filter((s) => s.scorePercent != null);
      const avgScorePercent = scored.length > 0 ? Math.round(scored.reduce((sum, s) => sum + (s.scorePercent ?? 0), 0) / scored.length) : 0;
      const passRate = scored.length > 0 ? Math.round((scored.filter((s) => s.passed).length / scored.length) * 100) : 0;
      quizStats = { avgScorePercent, passRate };
    }

    const ratingFields = form.fields.filter((f) => f.type === 'RATING');
    const ratingAverages = ratingFields.map((f) => {
      const values = submissions.flatMap((s) => s.answers.filter((a) => a.fieldId === f.id && a.valueText).map((a) => Number(a.valueText)));
      return { fieldId: f.id, label: f.label, average: values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null };
    });

    return { totalSubmissions, quizStats, ratingAverages };
  }
}
