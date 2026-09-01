import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { InvoicesService } from './invoices.service.js';
import type { CreateRecurringInvoiceDto } from './dto/create-recurring-invoice.dto.js';
import type { UpdateRecurringInvoiceDto } from './dto/update-recurring-invoice.dto.js';
import type { CreateInvoiceDto } from './dto/create-invoice.dto.js';

const TEMPLATE_INCLUDE = {
  contact: { select: { id: true, name: true, company: true } },
  deal: { select: { id: true, title: true } },
  lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

/** بعد از هر بار صدور، سررسید بعدی را بر اساس دوره‌ی تناوب جلو می‌برد. */
export function advanceNextRunAt(from: Date, frequency: string, intervalCount: number): Date {
  const next = new Date(from);
  switch (frequency) {
    case 'WEEKLY':
      next.setDate(next.getDate() + 7 * intervalCount);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + intervalCount);
      break;
    case 'QUARTERLY':
      next.setMonth(next.getMonth() + 3 * intervalCount);
      break;
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + intervalCount);
      break;
  }
  return next;
}

@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger('RecurringInvoicesService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  list(ctx: TenantRequestContext) {
    return ctx.tenantDb.recurringInvoiceTemplate.findMany({
      include: { contact: { select: { id: true, name: true, company: true } } },
      orderBy: { nextRunAt: 'asc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const template = await ctx.tenantDb.recurringInvoiceTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
    if (!template) throw new NotFoundException('قالب فاکتور تکرارشونده یافت نشد');
    return template;
  }

  async create(ctx: TenantRequestContext, dto: CreateRecurringInvoiceDto) {
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: dto.contactId } });
    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.recurringInvoiceTemplate.create({
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        frequency: dto.frequency,
        intervalCount: dto.intervalCount ?? 1,
        nextRunAt: new Date(dto.nextRunAt),
        discount: dto.discount ?? 0,
        isOfficial: dto.isOfficial ?? false,
        taxRate: dto.taxRate,
        notes: dto.notes,
        createdByUserId,
        lines: { create: dto.lines },
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateRecurringInvoiceDto) {
    await ctx.tenantDb.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.recurringInvoiceTemplate.update({
      where: { id },
      data: {
        contactId: dto.contactId,
        dealId: dto.dealId,
        frequency: dto.frequency,
        intervalCount: dto.intervalCount,
        ...(dto.nextRunAt ? { nextRunAt: new Date(dto.nextRunAt) } : {}),
        isActive: dto.isActive,
        discount: dto.discount,
        isOfficial: dto.isOfficial,
        taxRate: dto.taxRate,
        notes: dto.notes,
        ...(dto.lines ? { lines: { deleteMany: {}, create: dto.lines } } : {}),
      },
      include: TEMPLATE_INCLUDE,
    });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await ctx.tenantDb.recurringInvoiceTemplate.findUniqueOrThrow({ where: { id } });
    await ctx.tenantDb.recurringInvoiceTemplate.delete({ where: { id } });
    return { success: true };
  }

  /**
   * هر روز صبح همه‌ی تننت‌های فعال را برای قالب‌های سررسیدشده می‌گردد و به
   * ازای هر کدام یک فاکتور فروش تازه در حالت پیش‌نویس می‌سازد — صدور رسمی و
   * تأیید نهایی هنوز دستی است، این فقط از تایپ کردن دوباره‌ی همان اقلام هر
   * ماه جلوگیری می‌کند.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async generateDueInvoices(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.generateForTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Recurring invoice sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async generateForTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const due = await tenantDb.recurringInvoiceTemplate.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
      include: { lines: true },
    });
    if (due.length === 0) return;

    const ctx: TenantRequestContext = {
      tenantId,
      tenantSlug: '',
      tenantDb,
      auth: { type: 'api_key', sub: 'system-recurring-invoices', tenantId, role: 'OWNER' },
    };

    for (const template of due) {
      const invoiceDto: CreateInvoiceDto = {
        contactId: template.contactId,
        dealId: template.dealId ?? undefined,
        discount: template.discount || undefined,
        isOfficial: template.isOfficial,
        taxRate: template.taxRate ?? undefined,
        notes: template.notes ?? undefined,
        lines: template.lines.map((l) => ({
          productId: l.productId ?? undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      };
      const invoice = await this.invoices.create(ctx, invoiceDto);
      const nextRunAt = advanceNextRunAt(template.nextRunAt, template.frequency, template.intervalCount);
      await tenantDb.recurringInvoiceTemplate.update({
        where: { id: template.id },
        data: { lastRunAt: new Date(), lastGeneratedInvoiceId: invoice.id, nextRunAt },
      });
      this.logger.log(`Generated recurring invoice #${invoice.invoiceNo} for tenant ${tenantId} from template ${template.id}`);
    }
  }
}
