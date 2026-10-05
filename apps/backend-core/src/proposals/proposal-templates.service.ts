import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import type { CreateProposalTemplateDto, UpdateProposalTemplateDto } from './dto/proposal-actions.dto.js';

/**
 * قالب‌های آماده‌ی پروپوزال (برای پروژه‌های مشابه). قالب فقط متن و شرایط را نگه می‌دارد، نه مشتری و نه پیوست.
 * دسترسی: قالب‌ها بین همه‌ی کاربران ماژول مشترک‌اند؛ مشاهده برای هر کسی که به ماژول دسترسی دارد، ساخت/ویرایش/حذف طبق ماتریس.
 * ساخت قالب از یک پروپوزال، پروپوزال را از دامنه‌ی دسترسی کاربر (scope) می‌خواند.
 */
@Injectable()
export class ProposalTemplatesService {
  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.proposalTemplate.findMany({ orderBy: { updatedAt: 'desc' }, include: { createdBy: { select: { name: true } } } });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const t = await ctx.tenantDb.proposalTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('قالب یافت نشد');
    return t;
  }

  async create(ctx: TenantRequestContext, dto: CreateProposalTemplateDto, scope: Record<string, unknown>) {
    const createdByUserId = await resolveTenantUserId(ctx);
    let base: Partial<CreateProposalTemplateDto> = dto;
    if (dto.proposalId) {
      const p = await ctx.tenantDb.proposal.findFirst({ where: { AND: [{ id: dto.proposalId }, scope] } });
      if (!p) throw new NotFoundException('پروپوزال یافت نشد');
      base = {
        title: p.title,
        content: p.content,
        durationText: p.durationText ?? undefined,
        paymentMethodText: p.paymentMethodText ?? undefined,
        paymentTerms: p.paymentTerms ?? undefined,
        paymentDeadline: p.paymentDeadline ?? undefined,
        bankInfo: p.bankInfo ?? undefined,
        amount: p.amount,
        validDays: dto.validDays,
      };
    }
    return ctx.tenantDb.proposalTemplate.create({
      data: {
        name: dto.name.trim(),
        title: (base.title ?? dto.name).trim(),
        content: base.content ?? '',
        durationText: base.durationText,
        paymentMethodText: base.paymentMethodText,
        paymentTerms: base.paymentTerms,
        paymentDeadline: base.paymentDeadline,
        bankInfo: base.bankInfo,
        amount: base.amount ?? 0,
        validDays: base.validDays,
        createdByUserId: createdByUserId ?? undefined,
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateProposalTemplateDto) {
    await this.detail(ctx, id);
    return ctx.tenantDb.proposalTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        title: dto.title?.trim(),
        content: dto.content,
        durationText: dto.durationText,
        paymentMethodText: dto.paymentMethodText,
        paymentTerms: dto.paymentTerms,
        paymentDeadline: dto.paymentDeadline,
        bankInfo: dto.bankInfo,
        amount: dto.amount,
        validDays: dto.validDays,
      },
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.detail(ctx, id);
    await ctx.tenantDb.proposalTemplate.delete({ where: { id } });
    return { success: true };
  }
}
