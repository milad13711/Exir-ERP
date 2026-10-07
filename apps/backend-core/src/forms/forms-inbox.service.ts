import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

export const SUBMISSION_STATUSES = ['NEW', 'IN_REVIEW', 'DONE'] as const;
export type SubmissionStatusValue = (typeof SUBMISSION_STATUSES)[number];

const MAX_FORMS_IN_WIDGET = 8;
const LATEST_PER_FORM = 3;
const MAX_NOTE = 2000;

type Scope = Record<string, unknown>;

function preview(answers: Array<{ valueText: string | null; valueOptions: string[]; field: { label: string; sortOrder: number } }>): string | null {
  const first = [...answers].sort((a, b) => a.field.sortOrder - b.field.sortOrder).find((a) => a.valueText || a.valueOptions.length > 0);
  if (!first) return null;
  const v = first.valueOptions.length > 0 ? first.valueOptions.join('، ') : (first.valueText ?? '');
  return `${first.field.label}: ${v}`.slice(0, 120);
}

/**
 * صندوق ورودی فرم‌ها — پاسخ‌های «جدید»، مشاهده‌شدن و وضعیت پردازش.
 * همه‌ی متدها یک `scope` (خروجی formScope) می‌گیرند و پاسخ را از طریق فرمش محدود می‌کنند؛
 * شناسه‌ی خارج از دامنه ۴۰۴ می‌دهد (نه ۴۰۳) تا وجودش لو نرود.
 */
@Injectable()
export class FormsInboxService {
  async inboxSummary(ctx: TenantRequestContext, scope: Scope) {
    const visibleForms = await ctx.tenantDb.form.findMany({ where: { ...scope }, select: { id: true, title: true, slug: true, type: true } });
    if (visibleForms.length === 0) return { totalNew: 0, forms: [] };

    const grouped = await ctx.tenantDb.formSubmission.groupBy({
      by: ['formId'],
      where: { formId: { in: visibleForms.map((f) => f.id) }, status: 'NEW' },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.formId, g._count._all]));
    const totalNew = [...counts.values()].reduce((s, n) => s + n, 0);

    const top = visibleForms
      .filter((f) => (counts.get(f.id) ?? 0) > 0)
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .slice(0, MAX_FORMS_IN_WIDGET);

    const forms = await Promise.all(
      top.map(async (f) => {
        const latest = await ctx.tenantDb.formSubmission.findMany({
          where: { formId: f.id, status: 'NEW' },
          orderBy: { submittedAt: 'desc' },
          take: LATEST_PER_FORM,
          select: {
            id: true,
            submittedAt: true,
            respondentName: true,
            respondentPhone: true,
            answers: { select: { valueText: true, valueOptions: true, field: { select: { label: true, sortOrder: true } } } },
          },
        });
        return {
          formId: f.id,
          title: f.title,
          slug: f.slug,
          type: f.type,
          newCount: counts.get(f.id) ?? 0,
          latest: latest.map((s) => ({
            id: s.id,
            submittedAt: s.submittedAt,
            respondentName: s.respondentName,
            respondentPhone: s.respondentPhone,
            preview: s.respondentName || s.respondentPhone ? null : preview(s.answers),
          })),
        };
      }),
    );
    return { totalNew, forms };
  }

  /** تعداد پاسخ‌های جدید هر فرم — برای نشان کنار فهرست فرم‌ها. */
  async newCountsByForm(ctx: TenantRequestContext, formIds: string[]): Promise<Map<string, number>> {
    if (formIds.length === 0) return new Map();
    const grouped = await ctx.tenantDb.formSubmission.groupBy({ by: ['formId'], where: { formId: { in: formIds }, status: 'NEW' }, _count: { _all: true } });
    return new Map(grouped.map((g) => [g.formId, g._count._all]));
  }

  listSubmissions(ctx: TenantRequestContext, formId: string, scope: Scope, status?: string) {
    if (status && !(SUBMISSION_STATUSES as readonly string[]).includes(status)) throw new BadRequestException('وضعیت نامعتبر است');
    return ctx.tenantDb.formSubmission.findMany({
      where: { formId, form: { ...scope }, ...(status ? { status: status as SubmissionStatusValue } : {}) },
      include: {
        answers: { include: { field: { select: { label: true, type: true, sortOrder: true } } } },
        contact: { select: { id: true, name: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async submissionDetail(ctx: TenantRequestContext, submissionId: string, scope: Scope) {
    const s = await ctx.tenantDb.formSubmission.findFirst({
      where: { id: submissionId, form: { ...scope } },
      include: {
        answers: { include: { field: true } },
        contact: { select: { id: true, name: true } },
        form: { select: { id: true, title: true, slug: true, type: true, fields: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!s) throw new NotFoundException('این پاسخ یافت نشد');
    const viewer = s.viewedByUserId ? await ctx.tenantDb.user.findUnique({ where: { id: s.viewedByUserId }, select: { name: true } }) : null;
    return { ...s, viewedByName: viewer?.name ?? null };
  }

  /** باز شدن پاسخ: NEW → IN_REVIEW و ثبت اولین مشاهده. روی پاسخی که قبلاً دیده شده بی‌اثر است (idempotent). */
  async markViewed(ctx: TenantRequestContext, submissionId: string, scope: Scope, userId: string | null) {
    const s = await ctx.tenantDb.formSubmission.findFirst({ where: { id: submissionId, form: { ...scope } }, select: { id: true, status: true, viewedAt: true } });
    if (!s) throw new NotFoundException('این پاسخ یافت نشد');
    if (s.status !== 'NEW' && s.viewedAt) return { id: s.id, status: s.status, changed: false };
    const updated = await ctx.tenantDb.formSubmission.update({
      where: { id: s.id },
      data: {
        ...(s.status === 'NEW' ? { status: 'IN_REVIEW' as const } : {}),
        ...(s.viewedAt ? {} : { viewedAt: new Date(), viewedByUserId: userId }),
      },
      select: { id: true, status: true },
    });
    return { id: updated.id, status: updated.status, changed: true };
  }

  async updateSubmission(
    ctx: TenantRequestContext,
    submissionId: string,
    scope: Scope,
    dto: { status?: string; internalNote?: string | null },
    userId: string | null,
  ) {
    if (dto.status !== undefined && !(SUBMISSION_STATUSES as readonly string[]).includes(dto.status)) throw new BadRequestException('وضعیت نامعتبر است');
    if (dto.internalNote != null && dto.internalNote.length > MAX_NOTE) throw new BadRequestException('یادداشت بیش از حد طولانی است');
    const s = await ctx.tenantDb.formSubmission.findFirst({ where: { id: submissionId, form: { ...scope } }, select: { id: true, viewedAt: true } });
    if (!s) throw new NotFoundException('این پاسخ یافت نشد');
    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      // هر وضعیتی جز «جدید» یعنی کسی آن را دیده
      if (dto.status !== 'NEW' && !s.viewedAt) {
        data.viewedAt = new Date();
        data.viewedByUserId = userId;
      }
    }
    if (dto.internalNote !== undefined) data.internalNote = dto.internalNote?.trim() ? dto.internalNote.trim() : null;
    return ctx.tenantDb.formSubmission.update({ where: { id: s.id }, data, select: { id: true, status: true, internalNote: true, viewedAt: true } });
  }
}
