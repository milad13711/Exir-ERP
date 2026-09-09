import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateFormDto } from './dto/create-form.dto.js';
import type { UpdateFormDto } from './dto/update-form.dto.js';
import type { FormFieldDto } from './dto/form-field.dto.js';

const FORM_INCLUDE = {
  fields: { orderBy: { sortOrder: 'asc' as const } },
  createdBy: { select: { id: true, name: true } },
};

@Injectable()
export class FormsService {
  list(ctx: TenantRequestContext, filters: { status?: string; type?: string } = {}) {
    return ctx.tenantDb.form.findMany({
      where: {
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.type ? { type: filters.type as never } : {}),
      },
      include: { ...FORM_INCLUDE, _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const form = await ctx.tenantDb.form.findUnique({ where: { id }, include: { ...FORM_INCLUDE, _count: { select: { submissions: true } } } });
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

  listSubmissions(ctx: TenantRequestContext, formId: string) {
    return ctx.tenantDb.formSubmission.findMany({
      where: { formId },
      include: { answers: { include: { field: { select: { label: true, type: true } } } }, contact: { select: { id: true, name: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async submissionDetail(ctx: TenantRequestContext, submissionId: string) {
    const submission = await ctx.tenantDb.formSubmission.findUnique({
      where: { id: submissionId },
      include: { answers: { include: { field: true } }, contact: { select: { id: true, name: true } }, form: { select: { title: true } } },
    });
    if (!submission) throw new NotFoundException('این پاسخ یافت نشد');
    return submission;
  }

  /** خلاصه‌ی آمار — تعداد پاسخ، میانگین امتیاز رتبه‌ای (survey)، توزیع نمره و نرخ قبولی (quiz). */
  async stats(ctx: TenantRequestContext, formId: string) {
    const form = await ctx.tenantDb.form.findUnique({ where: { id: formId }, include: { fields: true } });
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
