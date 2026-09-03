import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { quotationCreatedPayload } from './sales-automation.triggers.js';
import type { CreateQuotationDto } from './dto/create-quotation.dto.js';
import type { UpdateQuotationDto } from './dto/update-quotation.dto.js';

const QUOTATION_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true, email: true } },
  deal: { select: { id: true, title: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      currency: { select: { code: true, symbol: true } },
    },
  },
};

function computeTotals<T extends { quantity: number; unitPrice: number }>(lines: T[], discount: number) {
  const withTotals = lines.map((l) => ({ ...l, lineTotal: l.quantity * l.unitPrice }));
  const subtotal = withTotals.reduce((sum, l) => sum + l.lineTotal, 0);
  if (discount > subtotal) throw new BadRequestException('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');
  return { lines: withTotals, subtotal, total: subtotal - discount };
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly automation: AutomationEngineService,
  ) {}

  list(ctx: TenantRequestContext, scope: Record<string, unknown>) {
    return ctx.tenantDb.salesQuotation.findMany({
      where: scope,
      include: { contact: { select: { id: true, name: true, company: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const quotation = await ctx.tenantDb.salesQuotation.findFirst({ where: { id, ...scope }, include: QUOTATION_INCLUDE });
    if (!quotation) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    return quotation;
  }

  private async findOwnedDraft(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const quotation = await ctx.tenantDb.salesQuotation.findFirst({ where: { id, ...scope } });
    if (!quotation) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    return quotation;
  }

  async create(ctx: TenantRequestContext, dto: CreateQuotationDto) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    const createdByUserId = await resolveTenantUserId(ctx);
    const { lines, subtotal, total } = computeTotals(dto.lines, dto.discount ?? 0);

    const quotation = await ctx.tenantDb.salesQuotation.create({
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        discount: dto.discount ?? 0,
        subtotal,
        total,
        notes: dto.notes,
        createdByUserId,
        lines: { create: lines },
      },
      include: QUOTATION_INCLUDE,
    });

    const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { slug: true } });
    await this.automation.emit(ctx, 'sales.quotation.created', quotationCreatedPayload(quotation, tenant.slug));

    return quotation;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateQuotationDto, scope: Record<string, unknown>) {
    const existing = await this.findOwnedDraft(ctx, id, scope);
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException('فقط پیش‌فاکتورهای پیش‌نویس قابل ویرایش هستند');
    }
    if (dto.contactId) {
      await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    }

    let totals: ReturnType<typeof computeTotals<NonNullable<typeof dto.lines>[number]>> | undefined;
    if (dto.lines) {
      totals = computeTotals(dto.lines, dto.discount ?? existing.discount);
    } else if (dto.discount !== undefined && dto.discount > existing.subtotal) {
      throw new BadRequestException('تخفیف نمی‌تواند از جمع اقلام بیشتر باشد');
    }

    return ctx.tenantDb.salesQuotation.update({
      where: { id },
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        ...(dto.validUntil !== undefined ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null } : {}),
        notes: dto.notes,
        discount: totals ? dto.discount ?? existing.discount : dto.discount,
        subtotal: totals?.subtotal,
        total: totals?.total,
        ...(dto.lines ? { lines: { deleteMany: {}, create: totals!.lines } } : {}),
      },
      include: QUOTATION_INCLUDE,
    });
  }

  async send(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const existing = await this.findOwnedDraft(ctx, id, scope);
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException('فقط پیش‌فاکتور پیش‌نویس قابل ارسال است');
    }
    return ctx.tenantDb.salesQuotation.update({ where: { id }, data: { status: 'SENT' }, include: QUOTATION_INCLUDE });
  }

  async respond(ctx: TenantRequestContext, id: string, accepted: boolean, scope: Record<string, unknown>) {
    const existing = await this.findOwnedDraft(ctx, id, scope);
    if (existing.status !== 'SENT') {
      throw new ForbiddenException('فقط پیش‌فاکتور ارسال‌شده قابل پاسخ است');
    }
    return ctx.tenantDb.salesQuotation.update({
      where: { id },
      data: { status: accepted ? 'ACCEPTED' : 'REJECTED', respondedAt: new Date() },
      include: QUOTATION_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const existing = await this.findOwnedDraft(ctx, id, scope);
    if (existing.status !== 'DRAFT') {
      throw new ForbiddenException('فقط پیش‌فاکتورهای پیش‌نویس قابل حذف هستند');
    }
    await ctx.tenantDb.salesQuotation.delete({ where: { id } });
    return { success: true };
  }

  /** Creates a real SalesInvoice from this quotation's current lines and marks the quotation CONVERTED. */
  async convertToInvoice(ctx: TenantRequestContext, id: string, scope: Record<string, unknown>) {
    const quotation = await ctx.tenantDb.salesQuotation.findFirst({
      where: { id, ...scope },
      include: { lines: true },
    });
    if (!quotation) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    if (quotation.status === 'CONVERTED') {
      throw new ForbiddenException('این پیش‌فاکتور قبلاً به فاکتور تبدیل شده است');
    }
    if (quotation.status === 'REJECTED' || quotation.status === 'EXPIRED') {
      throw new ForbiddenException('پیش‌فاکتور رد‌شده یا منقضی قابل تبدیل به فاکتور نیست');
    }

    const createdByUserId = await resolveTenantUserId(ctx);
    const invoice = await ctx.tenantDb.salesInvoice.create({
      data: {
        contactId: quotation.contactId,
        dealId: quotation.dealId,
        discount: quotation.discount,
        subtotal: quotation.subtotal,
        total: quotation.total,
        notes: quotation.notes,
        createdByUserId,
        lines: {
          create: quotation.lines.map((l) => ({
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: { contact: { select: { id: true, name: true, company: true } } },
    });

    await ctx.tenantDb.salesQuotation.update({
      where: { id },
      data: { status: 'CONVERTED', convertedInvoiceId: invoice.id },
    });

    return invoice;
  }
}
